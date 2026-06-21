// Wire contracts shared across the worker, the .NET CRM Agent, and the Chrome
// extension. Field names are frozen — do not rename. See docs §4.

export type Hello = {
  type: "HELLO";
  token: string;
  repUserId: string;
  zoomExtension?: string;
  machineId: string;
  agentVersion: string;
};

export type StartCommand = {
  type: "START";
  callId: string;
  repUserId: string;
  channel: "desktop" | "web";
  phoneE164: string | null;
  counterpartyName?: string;
  connectTsMs: number;
};

export type StopCommand = {
  type: "STOP";
  callId: string;
  endTsMs: number;
};

export type Ping = { type: "PING" };
export type Pong = { type: "PONG" };

export type RecordCommand = StartCommand | StopCommand | Ping | Pong;

export type IncomingFrame = Hello | Ping | Pong;
