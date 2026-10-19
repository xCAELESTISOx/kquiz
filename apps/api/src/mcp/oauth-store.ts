import { createHash, randomBytes } from "node:crypto";

export interface OAuthClient {
  clientId: string;
  /** SHA-256 of the secret; absent for public clients. */
  secretHash?: string;
  name: string;
  redirectUris: string[];
  createdAt: number;
  /** Set once the owner approved this client at least once. */
  approvedAt?: number;
}

export interface AuthCode {
  codeHash: string;
  /** Who approved it: the grant made from it works on their cards. */
  userId: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
}

/** One approval of one client. Every token pair it rotates through belongs to it. */
export interface Grant {
  id: string;
  userId: number;
  clientId: string;
  scope: string;
  createdAt: number;
  lastUsedAt: number;
  accessHash: string;
  accessExpiresAt: number;
  refreshHash: string;
  refreshExpiresAt: number;
  /** Refresh tokens already rotated away; presenting one again revokes the grant. */
  usedRefreshHashes: string[];
}

/**
 * OAuth state for every user's connectors. Tokens and codes are stored only as hashes.
 * The SQLite store in apps/api (auth_* tables) implements it; MemoryOAuthStore stands in until then.
 */
export interface OAuthStore {
  countClients(): Promise<number>;
  /** Removes the oldest client the owner never approved; false when there is none. */
  evictOldestUnapprovedClient(): Promise<boolean>;
  saveClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;
  markClientApproved(clientId: string, at: number): Promise<void>;

  saveCode(code: AuthCode): Promise<void>;
  /** Returns the code and deletes it, so each code works once. */
  takeCode(codeHash: string): Promise<AuthCode | null>;

  saveGrant(grant: Grant): Promise<void>;
  findGrantByAccess(accessHash: string): Promise<Grant | null>;
  /** Finds a grant by its current or an already rotated refresh token. */
  findGrantByRefresh(refreshHash: string): Promise<Grant | null>;
  /** Records when the grant was last used, for the settings screen. */
  touchGrant(id: string, at: number): Promise<void>;
  listGrants(): Promise<Grant[]>;
  deleteGrant(id: string): Promise<void>;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export class MemoryOAuthStore implements OAuthStore {
  private clients = new Map<string, OAuthClient>();
  private codes = new Map<string, AuthCode>();
  private grants = new Map<string, Grant>();

  async countClients() {
    return this.clients.size;
  }

  async evictOldestUnapprovedClient() {
    let oldest: OAuthClient | undefined;
    for (const client of this.clients.values()) {
      if (!client.approvedAt && (!oldest || client.createdAt < oldest.createdAt)) oldest = client;
    }
    if (!oldest) return false;
    this.clients.delete(oldest.clientId);
    return true;
  }

  async saveClient(client: OAuthClient) {
    this.clients.set(client.clientId, client);
  }

  async getClient(clientId: string) {
    return this.clients.get(clientId) ?? null;
  }

  async markClientApproved(clientId: string, at: number) {
    const client = this.clients.get(clientId);
    if (client) client.approvedAt ??= at;
  }

  async saveCode(code: AuthCode) {
    this.codes.set(code.codeHash, code);
  }

  async takeCode(codeHash: string) {
    const code = this.codes.get(codeHash) ?? null;
    this.codes.delete(codeHash);
    return code;
  }

  async saveGrant(grant: Grant) {
    this.grants.set(grant.id, grant);
  }

  async findGrantByAccess(accessHash: string) {
    for (const grant of this.grants.values()) if (grant.accessHash === accessHash) return grant;
    return null;
  }

  async findGrantByRefresh(refreshHash: string) {
    for (const grant of this.grants.values()) {
      if (grant.refreshHash === refreshHash || grant.usedRefreshHashes.includes(refreshHash)) return grant;
    }
    return null;
  }

  async touchGrant(id: string, at: number) {
    const grant = this.grants.get(id);
    if (grant) grant.lastUsedAt = at;
  }

  async listGrants() {
    return [...this.grants.values()];
  }

  async deleteGrant(id: string) {
    this.grants.delete(id);
  }
}
