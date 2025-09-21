declare module 'neo4j-driver' {
  export interface Auth {
    basic(username: string, password: string): AuthToken;
  }

  export interface AuthToken {
    scheme: string;
    principal: string;
    credentials: string;
  }

  export interface Config {
    encrypted?: boolean;
    trust?: string;
    trustedCertificates?: string[];
    knownHosts?: string;
    maxConnectionPoolSize?: number;
    maxTransactionRetryTime?: number;
    connectionAcquisitionTimeout?: number;
    loadBalancingStrategy?: any;
    maxConnectionLifetime?: number;
    connectionTimeout?: number;
    disableLosslessIntegers?: boolean;
    useBigInt?: boolean;
    logging?: any;
  }

  export interface Record {
    keys: string[];
    length: number;
    get(key: string): any;
    has(key: string): boolean;
    forEach(callback: (value: any, key: string) => void): void;
    toObject(): { [key: string]: any };
  }

  export interface Result {
    records: Record[];
    summary: ResultSummary;
  }

  export interface ResultSummary {
    query: { text: string; parameters: any };
    queryType: string;
    counters: any;
    updateStatistics: any;
    plan: any;
    profile: any;
    notifications: any[];
    server: any;
    resultConsumedAfter: number;
    resultAvailableAfter: number;
  }

  export interface Session {
    run(query: string, parameters?: any): Promise<Result>;
    readTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
    writeTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
    close(): Promise<void>;
  }

  export interface Transaction {
    run(query: string, parameters?: any): Promise<Result>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }

  export interface Driver {
    session(config?: { defaultAccessMode?: string }): Session;
    close(): Promise<void>;
  }

  export const auth: Auth;

  export function driver(
    url: string,
    authToken: AuthToken,
    config?: Config
  ): Driver;

  export default {
    auth,
    driver,
    types: {
      Node: class Node {
        constructor(identity: any, labels: string[], properties: any);
        identity: any;
        labels: string[];
        properties: any;
      },
      Relationship: class Relationship {
        constructor(identity: any, start: any, end: any, type: string, properties: any);
        identity: any;
        start: any;
        end: any;
        type: string;
        properties: any;
      },
      Path: class Path {
        constructor(start: any, segments: any[]);
        start: any;
        segments: any[];
        end: any;
        length: number;
      },
      PathSegment: class PathSegment {
        constructor(relationship: any, end: any);
        relationship: any;
        end: any;
      }
    }
  };
}
