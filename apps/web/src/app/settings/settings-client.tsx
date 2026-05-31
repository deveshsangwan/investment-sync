"use client";

import { trpc } from "../providers";

export function SettingsClient() {
  const me = trpc.auth.me.useQuery();
  const accounts = trpc.accounts.list.useQuery();

  return (
    <main className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Accounts and access</h1>
          <p className="muted">
            Family sharing is modeled in the database and can be enabled after
            v1.
          </p>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="panel">
          <h2>Household</h2>
          <p>{me.data?.user?.householdName ?? "My Portfolio"}</p>
          <p className="muted">{me.data?.user?.email}</p>
        </div>

        <div className="panel">
          <h2>Original uploads</h2>
          <p>
            Original files are retained for 30 days, then removed by the daily
            cleanup job.
          </p>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Accounts</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Provider</th>
              <th>Type</th>
              <th>Currency</th>
            </tr>
          </thead>
          <tbody>
            {accounts.data?.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td>{account.provider}</td>
                <td>{account.accountType}</td>
                <td>{account.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
