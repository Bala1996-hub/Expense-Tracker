create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null,
  description text not null default '',
  category text not null,
  expense_type text not null check (expense_type in ('self', 'claim')),
  amount numeric(12, 3) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_date date not null,
  friend text not null,
  loan_type text not null check (loan_type in ('disbursed', 'repaid')),
  notes text not null default '',
  amount numeric(12, 3) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  amount numeric(12, 3) not null,
  created_at timestamptz not null default now(),
  unique (user_id, category)
);

alter table public.expenses enable row level security;
alter table public.loans enable row level security;
alter table public.limits enable row level security;

create policy "Users can read their own expenses"
on public.expenses
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own expenses"
on public.expenses
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own expenses"
on public.expenses
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own expenses"
on public.expenses
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own loans"
on public.loans
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own loans"
on public.loans
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own loans"
on public.loans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own loans"
on public.loans
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own limits"
on public.limits
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own limits"
on public.limits
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own limits"
on public.limits
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own limits"
on public.limits
for delete
to authenticated
using (auth.uid() = user_id);
