# Expense Tracker Firebase Functions

These functions let the web page save each user's backup JSON into that user's own Google Drive while keeping the Google refresh token server-side.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your Google OAuth web client values.
3. In Google Cloud OAuth credentials, add this authorized redirect URI:

```txt
https://us-central1-expense-tracker-494021.cloudfunctions.net/driveOAuthCallback
```

4. Install and deploy:

```bash
npm install
firebase deploy --only functions
```

The web page defaults to:

```txt
https://us-central1-expense-tracker-494021.cloudfunctions.net
```

If you deploy to another region, update the Firebase Functions base URL in the Data tab.
