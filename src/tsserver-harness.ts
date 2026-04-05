import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";

export interface TsDiagnostic {
  text: string;
  start: { line: number; offset: number };
  end: { line: number; offset: number };
  category: string;
  code: number;
}

export interface TsCompletionEntry {
  name: string;
  kind: string;
  kindModifiers: string;
  sortText: string;
}

export interface TsQuickInfo {
  displayString: string;
  documentation?: Array<{ text: string }>;
}

interface TsServerResponse {
  seq: number;
  request_seq: number;
  type: "response";
  command: string;
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
  message?: string;
}

export class TsServerHarness {
  private proc: ChildProcess | null = null;
  private seq = 1;
  private readonly pending = new Map<number, {
    resolve: (r: TsServerResponse) => void;
    reject: (e: Error) => void;
  }>();
  private buf = "";
  private readonly openFiles = new Set<string>();

  constructor(
    private readonly tsserverBin: string,
    private readonly nodeBin: string,
    private readonly projectRoot: string,
  ) {}

  async start(): Promise<void> {
    this.proc = spawn(this.nodeBin, [this.tsserverBin], {
      cwd: this.projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TSS_LOG: "-level verbose -file /tmp/tsserver.log",
      },
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString("utf8");
      this.flush();
    });

    this.proc.stderr!.on("data", (_chunk: Buffer) => {
      // tsserver writes diagnostic info to stderr — ignore
    });

    this.proc.on("error", (err) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`tsserver process error: ${err.message}`));
      }
      this.pending.clear();
    });

    // Wait for tsserver to be ready by sending a dummy ping-style request
    await this.sendRequest("configure", {
      hostInfo: "integration-test",
      preferences: {},
    });
  }

  private flush(): void {
    const HEADER_RE = /Content-Length: (\d+)\r\n\r\n/;
    while (true) {
      const match = HEADER_RE.exec(this.buf);
      if (!match) break;
      const contentLength = parseInt(match[1], 10);
      const bodyStart = match.index + match[0].length;
      if (this.buf.length < bodyStart + contentLength) break;

      const body = this.buf.slice(bodyStart, bodyStart + contentLength);
      this.buf = this.buf.slice(bodyStart + contentLength);

      let parsed: TsServerResponse;
      try {
        parsed = JSON.parse(body) as TsServerResponse;
      } catch {
        continue;
      }

      if (parsed.type === "response" && this.pending.has(parsed.request_seq)) {
        const handler = this.pending.get(parsed.request_seq)!;
        this.pending.delete(parsed.request_seq);
        handler.resolve(parsed);
      }
    }
  }

  private sendRequest(command: string, args: object): Promise<TsServerResponse> {
    return new Promise((resolve, reject) => {
      const seq = this.seq++;

      const timer = setTimeout(() => {
        if (this.pending.has(seq)) {
          this.pending.delete(seq);
          reject(new Error(`tsserver request timed out: ${command} (seq=${seq})`));
        }
      }, 30_000);

      this.pending.set(seq, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      const payload = JSON.stringify({ seq, type: "request", command, arguments: args });
      this.proc!.stdin!.write(payload + "\n");
    });
  }

  private async ensureOpen(file: string): Promise<void> {
    if (this.openFiles.has(file)) return;
    await this.sendRequest("open", {
      file,
      scriptKindName: "TS",
    });
    this.openFiles.add(file);

    // Give tsserver a moment to process the file
    await new Promise((r) => setTimeout(r, 500));
  }

  async getSemanticDiagnostics(file: string): Promise<TsDiagnostic[]> {
    await this.ensureOpen(file);
    const resp = await this.sendRequest("semanticDiagnosticsSync", { file });
    if (!resp.success) return [];
    return (resp.body as TsDiagnostic[]) ?? [];
  }

  async getSyntacticDiagnostics(file: string): Promise<TsDiagnostic[]> {
    await this.ensureOpen(file);
    const resp = await this.sendRequest("syntacticDiagnosticsSync", { file });
    if (!resp.success) return [];
    return (resp.body as TsDiagnostic[]) ?? [];
  }

  async getCompletions(file: string, line: number, offset: number): Promise<TsCompletionEntry[]> {
    await this.ensureOpen(file);
    const resp = await this.sendRequest("completions", { file, line, offset, includeExternalModuleExports: false });
    if (!resp.success) return [];
    const body = resp.body as { entries?: TsCompletionEntry[] } | TsCompletionEntry[] | null;
    if (Array.isArray(body)) return body;
    return body?.entries ?? [];
  }

  async getQuickInfo(file: string, line: number, offset: number): Promise<TsQuickInfo | undefined> {
    await this.ensureOpen(file);
    const resp = await this.sendRequest("quickinfo", { file, line, offset });
    if (!resp.success) return undefined;
    return resp.body as TsQuickInfo;
  }

  async close(): Promise<void> {
    for (const file of this.openFiles) {
      try {
        await this.sendRequest("close", { file });
      } catch {
        // ignore
      }
    }
    this.openFiles.clear();

    if (this.proc) {
      this.proc.kill();
      await new Promise<void>((resolve) => {
        this.proc!.once("exit", () => resolve());
        setTimeout(() => resolve(), 3_000);
      });
      this.proc = null;
    }
  }
}
