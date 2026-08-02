# Certificates managed by the panel

This fork issues TLS certificates itself and delivers them to nodes, instead of
leaving that to an external agent that writes into config profiles.

## The model

Three entities, in the shape Nginx Proxy Manager made familiar:

- **Credential** — how DNS challenges are answered. Reusable: many certificates
  share one.
- **Certificate** — domains, a credential, a CA and renewal settings.
- **Binding** — which nodes get the certificate, and optionally which inbound
  tags on them.

A certificate is bound to **nodes**, not to a config profile. Several nodes can
share a profile, so writing a certificate into the profile would hand its private
key to every node using it — including nodes that never serve the name. Instead
the certificate is injected into the config of each bound node as it is sent.

## Setup

1. Generate the key that encrypts ACME secrets at rest and put it in the panel
   environment:

   ```bash
   cli generate-acme-key
   ```

   ```
   ACME_SECRET_KEY=<32 bytes, base64>
   ```

   It protects DNS credentials, ACME account keys and certificate private keys.
   It is separate from `APP_SECRET` on purpose: rotating the login secret should
   not make stored certificates unreadable. Changing it makes everything already
   stored unreadable — certificates would have to be re-issued.

   Without the key the pages still load, and every write answers with
   `ACME_SECRET_KEY is not set`.

2. Open **Management → Certificates → Credentials** and add one:

   | Provider | What the panel stores | When to use it |
   | --- | --- | --- |
   | `ACME_PROXY` | base URL and a client token | Preferred. The DNS provider credentials and the domain policy stay on [acme-proxy](https://github.com/nd4y/acme-proxy); a compromised panel can only create ACME validation records for allowed names. |
   | `CLOUDFLARE` | an API token | Simple, but the token can edit every record in its zones, from an internet-facing service. |
   | `MANUAL` | nothing | Pairs with dns-persist-01: one record is published by hand and renewals need no DNS access. It cannot answer dns-01. |

   The **Test** action reports whether the credential works and, for acme-proxy,
   which domains it is allowed to touch — worth doing before the first issuance,
   because otherwise an allow-list mismatch shows up as a failed order weeks
   later.

3. Add a certificate. It defaults to a **staging** CA: rehearse a new name there
   first, then switch to production. Staging endpoints for every supported CA are
   in the list.

4. Bind it to nodes and press **Issue now**. The order runs in the background;
   the status and the log in the details drawer show what happened.

## Renewals

An hourly job queues certificates that are inside their renewal window, have
never been issued, or failed with the backoff expired. After a successful order,
every bound node is restarted so it picks the new certificate up.

The certificate fingerprint is mixed into the config hash the node compares
against its previous one. Without that a renewal would change nothing the node
can see — the profile is identical — and the new certificate would sit in the
panel unused.

## dns-persist-01

`dns-persist-01` (draft-ietf-acme-dns-persist) replaces the per-issuance TXT
record with a persistent authorization record bound to the ACME account. Once
published, issuance and renewal need no DNS access at all.

The details drawer shows the record to publish and can publish it through the
certificate's credential. For a wildcard the record goes on the **base** name
without the asterisk, with `policy=wildcard` in the value; the asterisk in the
record name is a name the CA never asks for.

As of 2026-08 Let's Encrypt supports it on staging only; a production order is
refused by the CA with a clear message in the certificate log.

## Failures

Every attempt is recorded on the certificate: `lastError`, `failCount` and
`nextRetryAt`, plus an entry in its log. Retries back off, doubling up to a day,
so a broken credential still retries daily instead of hammering the CA.

Challenge records are removed whether the order succeeded or not.
