const crypto = require("crypto");
const cors = require("cors");
const { google } = require("googleapis");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const driveScope = "https://www.googleapis.com/auth/drive.file";
const backupFileName = "expense-tracker-backup.json";
const corsHandler = cors({ origin: true });

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_DRIVE_REDIRECT_URI.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function runCors(req, res) {
  return new Promise((resolve, reject) => {
    corsHandler(req, res, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function requireUser(req) {
  const authHeader = req.get("Authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);

  if (!match) {
    const error = new Error("Missing Firebase ID token.");
    error.status = 401;
    throw error;
  }

  return admin.auth().verifyIdToken(match[1]);
}

function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || "Request failed."
  });
}

function safeReturnUrl(value) {
  const fallback = "https://bala1996-hub.github.io/Expense-Tracker/";
  if (!value) return fallback;

  const url = new URL(value);
  const allowedOrigins = (process.env.ALLOWED_RETURN_ORIGINS || "https://bala1996-hub.github.io,http://localhost:8000,http://127.0.0.1:8000")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  if (!allowedOrigins.includes(url.origin)) {
    return fallback;
  }

  return url.toString();
}

function addQuery(url, params) {
  const parsed = new URL(url);
  Object.entries(params).forEach(([key, value]) => parsed.searchParams.set(key, value));
  return parsed.toString();
}

function buildMultipartBody(metadata, content) {
  const boundary = `expense_tracker_boundary_${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`
  ].join("\r\n");

  return { boundary, body };
}

async function uploadDriveBackup(oauthClient, fileId, backup) {
  const content = JSON.stringify(backup, null, 2);
  const metadata = {
    name: backupFileName,
    mimeType: "application/json"
  };
  const multipart = buildMultipartBody(metadata, content);
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime";

  const response = await oauthClient.request({
    url,
    method: fileId ? "PATCH" : "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${multipart.boundary}`
    },
    data: multipart.body
  });

  return response.data;
}

exports.startDriveAuth = onRequest({ cors: true }, async (req, res) => {
  try {
    await runCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

    const user = await requireUser(req);
    const returnUrl = safeReturnUrl(req.body && req.body.returnUrl);
    const state = crypto.randomBytes(24).toString("hex");

    await db.collection("driveOAuthStates").doc(state).set({
      uid: user.uid,
      returnUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const oauthClient = getOAuthClient();
    const authUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [driveScope],
      state
    });

    res.json({ authUrl });
  } catch (error) {
    sendError(res, error);
  }
});

exports.driveOAuthCallback = onRequest({ cors: true }, async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      return res.status(400).send(`Google Drive authorization failed: ${oauthError}`);
    }

    if (!code || !state) {
      return res.status(400).send("Missing Google OAuth code or state.");
    }

    const stateRef = db.collection("driveOAuthStates").doc(String(state));
    const stateDoc = await stateRef.get();

    if (!stateDoc.exists) {
      return res.status(400).send("Invalid or expired OAuth state.");
    }

    const stateData = stateDoc.data();
    const oauthClient = getOAuthClient();
    const { tokens } = await oauthClient.getToken(String(code));

    if (!tokens.refresh_token) {
      const existingDrive = await db.collection("users").doc(stateData.uid).collection("sync").doc("drive").get();

      if (!existingDrive.exists || !existingDrive.data().refreshToken) {
        const retryUrl = addQuery(stateData.returnUrl, {
          driveError: "Google did not return a refresh token. Try Connect Drive again."
        });
        await stateRef.delete();
        return res.redirect(retryUrl);
      }
    }

    const driveUpdate = {
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncAt: null
    };

    if (tokens.refresh_token) {
      driveUpdate.refreshToken = tokens.refresh_token;
    }

    await db.collection("users").doc(stateData.uid).collection("sync").doc("drive").set(driveUpdate, { merge: true });

    await stateRef.delete();
    res.redirect(addQuery(stateData.returnUrl, { driveConnected: "1" }));
  } catch (error) {
    res.status(500).send(error.message || "Google Drive callback failed.");
  }
});

exports.saveDriveBackup = onRequest({ cors: true }, async (req, res) => {
  try {
    await runCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

    const user = await requireUser(req);
    const backup = req.body && req.body.backup;
    if (!backup || typeof backup !== "object") {
      return res.status(400).json({ error: "Missing backup object." });
    }

    const driveRef = db.collection("users").doc(user.uid).collection("sync").doc("drive");
    const driveDoc = await driveRef.get();
    const driveData = driveDoc.data() || {};

    if (!driveData.refreshToken) {
      return res.status(409).json({ error: "Google Drive is not connected for this user." });
    }

    const oauthClient = getOAuthClient();
    oauthClient.setCredentials({ refresh_token: driveData.refreshToken });

    const savedFile = await uploadDriveBackup(oauthClient, driveData.backupFileId || "", backup);
    await driveRef.set({
      backupFileId: savedFile.id,
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({
      backupFileId: savedFile.id,
      modifiedTime: savedFile.modifiedTime || null
    });
  } catch (error) {
    sendError(res, error);
  }
});

exports.loadDriveBackup = onRequest({ cors: true }, async (req, res) => {
  try {
    await runCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

    const user = await requireUser(req);
    const driveRef = db.collection("users").doc(user.uid).collection("sync").doc("drive");
    const driveDoc = await driveRef.get();
    const driveData = driveDoc.data() || {};

    if (!driveData.refreshToken || !driveData.backupFileId) {
      return res.status(404).json({ error: "No Google Drive backup file is connected yet." });
    }

    const oauthClient = getOAuthClient();
    oauthClient.setCredentials({ refresh_token: driveData.refreshToken });

    const response = await oauthClient.request({
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveData.backupFileId)}?alt=media`,
      method: "GET"
    });

    res.json({
      backup: response.data,
      backupFileId: driveData.backupFileId
    });
  } catch (error) {
    sendError(res, error);
  }
});
