'use strict';

const { CustodyProvider, NotImplementedError } = require('./provider');

/**
 * DEFERRED — gated on a funded Team customer (plan Part 1-D / §1.D.8 / Phase 3+).
 *
 * This stub exists so the 19 Gmail tools + tokenFor() are custody-agnostic NOW,
 * making the Team tier a drop-in implementation later rather than a rewrite.
 * It deliberately throws on every data method: NO server-side token custody
 * ships in v1. Native Gmail delegation was verified (2026-06-08) NOT to provide
 * a cheaper local path, so a concurrently-shared mailbox can only be served via
 * this broker (or domain-wide delegation, which the plan rejects on security
 * grounds).
 *
 * Documented broker request contract (plan §1.D.8), recorded here for the future
 * implementation — broker-as-proxy: the Google token NEVER leaves the broker.
 */
const BROKER_CONTRACT = Object.freeze({
  channel: 'mTLS / workload-identity authenticated (only the known MCP-app workload may call)',
  request: Object.freeze({
    user_access_token: 'the original signed JWT the MCP client presented (broker re-verifies vs AS JWKS)',
    mailbox_id: 'the shared mailbox to act on',
    operation: 'one of a fixed allowlist',
    args: 'schema-validated per operation',
    request_id: 'idempotency / audit correlation',
  }),
  response: '{ result | error } — NEVER a token (Google token stays broker-side)',
  invariants: Object.freeze([
    'derive tenant_id/user_id from the verified token, never from the request body',
    'grant checked per-request (tenant-scoped); the app cannot escalate beyond the user grant',
    'fail-closed: JWKS / grant store / vault unreachable => deny',
    'high-risk ops (external send / trash / bulk export) gated; read-volume anomaly detection on',
  ]),
});

class ServerBrokerProvider extends CustodyProvider {
  constructor(config = {}) {
    super();
    this.config = config; // { brokerEndpoint, getUserAccessToken, ... } — wired up when built
  }

  async putRefreshToken() { throw this._gate('putRefreshToken'); }
  async getAccessToken() { throw this._gate('getAccessToken'); }
  async removeAccount() { throw this._gate('removeAccount'); }
  async updateAccountMeta() { throw this._gate('updateAccountMeta'); }
  async listAccounts() { throw this._gate('listAccounts'); }

  describe() {
    return {
      kind: 'server-broker',
      custodian: 'broker-vault (server-side)',
      mailExposedToOperator: true,
      tokenLeavesDevice: true,
      status: 'NOT_IMPLEMENTED — deferred to a funded Team tier (plan Part 1-D, §1.D.8)',
      contract: BROKER_CONTRACT,
    };
  }

  _gate(method) {
    return new NotImplementedError(
      `ServerBrokerProvider.${method}() is not implemented. Shared-mailbox custody is gated on a ` +
      `funded Team customer (plan Part 1-D / Phase 3+). v1 ships local-first only.`
    );
  }
}

module.exports = { ServerBrokerProvider, BROKER_CONTRACT };
