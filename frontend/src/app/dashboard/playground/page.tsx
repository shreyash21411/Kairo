"use client";

import React, { useState } from "react";
import { useProject } from "@/providers/project-provider";
import { memoriesApi } from "@/lib/api/memoriesApi";
import { MemoryType, VALID_MEMORY_TYPES } from "@/types/memory";
import { ApiError } from "@/types/api";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/dashboard/status-banner";
import {
  Terminal,
  Play,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  User,
  Copy,
  Check,
} from "lucide-react";

// ─── Operations available in the Playground ───────────────────────────────────
type Operation = "remember" | "recall";

const OPERATIONS: { id: Operation; label: string; method: string; path: string; description: string }[] = [
  {
    id: "remember",
    label: "Remember",
    method: "POST",
    path: "/api/v1/memories",
    description: "Store a durable memory, embed it via Mistral AI, and deduplicate within the actor scope.",
  },
  {
    id: "recall",
    label: "Recall",
    method: "POST",
    path: "/api/v1/memories/search",
    description: "Execute semantic similarity search across vector embeddings scoped to an actor.",
  },
];

// ─── Request Preview ──────────────────────────────────────────────────────────
function RequestPreview({
  method,
  path,
  body,
  hasMaskedKey,
}: {
  method: string;
  path: string;
  body: object;
  hasMaskedKey: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = `${method} ${path}\nAuthorization: Bearer voidzone_live_••••••••\nContent-Type: application/json\n\n${JSON.stringify(body, null, 2)}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-surface-subtle/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold text-blue-500">{method}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{path}</span>
        </div>
        <button
          onClick={handleCopy}
          disabled={!hasMaskedKey}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Copy request"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="px-3 py-3 text-[11px] font-mono text-muted-foreground leading-relaxed overflow-x-auto">
        <span className="text-muted-foreground/60">Authorization: </span>
        <span className="text-foreground">
          Bearer {hasMaskedKey ? "voidzone_live_••••••••" : "<session key>"}
        </span>
        {"\n"}
        <span className="text-muted-foreground/60">Content-Type: </span>
        <span className="text-foreground">application/json</span>
        {"\n\n"}
        <span className="text-foreground/80">{JSON.stringify(body, null, 2)}</span>
      </pre>
    </div>
  );
}

// ─── Response Viewer ──────────────────────────────────────────────────────────
function ResponseViewer({
  status,
  data,
  error,
}: {
  status: number | null;
  data: unknown;
  error: string | null;
}) {
  const isSuccess = status !== null && status < 400;
  const statusColor = !status ? "text-muted-foreground" : isSuccess ? "text-emerald-500" : "text-destructive";

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-surface-subtle/30">
        {status !== null ? (
          isSuccess ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
          )
        ) : null}
        <span className={`text-[10px] font-mono font-semibold ${statusColor}`}>
          {status !== null ? `HTTP ${status}` : "—"}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">Response</span>
      </div>
      <pre className="px-3 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-72">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : data !== null ? (
          <span className="text-foreground/80">{JSON.stringify(data, null, 2)}</span>
        ) : (
          <span className="text-muted-foreground/40">Execute an operation to see the response</span>
        )}
      </pre>
    </div>
  );
}

// ─── Main Playground ──────────────────────────────────────────────────────────
export default function PlaygroundPage() {
  const { selectedProject, sessionApiKey, activeActorId } = useProject();

  const [operation, setOperation] = useState<Operation>("remember");
  const [actorId, setActorId] = useState(activeActorId);
  const [isExecuting, setIsExecuting] = useState(false);

  // Remember inputs
  const [rememberContent, setRememberContent] = useState(
    "The user prefers TypeScript for all new projects and uses VS Code with the Dracula theme."
  );
  const [rememberType, setRememberType] = useState<MemoryType>("Preference");

  // Recall inputs
  const [recallQuery, setRecallQuery] = useState("What are the user's development preferences?");
  const [recallTopK, setRecallTopK] = useState(5);

  // Response state
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseData, setResponseData] = useState<unknown>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => { setActorId(activeActorId); }, [activeActorId]);
  React.useEffect(() => {
    setResponseStatus(null);
    setResponseData(null);
    setResponseError(null);
  }, [selectedProject, sessionApiKey, operation]);

  const currentOp = OPERATIONS.find((o) => o.id === operation)!;

  const requestBody =
    operation === "remember"
      ? { content: rememberContent, memoryType: rememberType, actorId }
      : { query: recallQuery, topK: recallTopK, actorId };

  const handleExecute = async () => {
    if (!sessionApiKey) {
      setError("A project API key is required. Configure one in the API Keys section.");
      return;
    }
    if (!actorId.trim()) {
      setError("Actor ID is required.");
      return;
    }

    setError(null);
    setResponseStatus(null);
    setResponseData(null);
    setResponseError(null);
    setIsExecuting(true);

    try {
      if (operation === "remember") {
        const outcome = await memoriesApi.create(sessionApiKey, {
          content: rememberContent.trim(),
          memoryType: rememberType,
          actorId: actorId.trim(),
        });

        if (outcome.isDuplicate) {
          setResponseStatus(200);
          setResponseData(outcome.duplicate);
        } else {
          setResponseStatus(201);
          setResponseData(outcome.memory);
        }
      } else {
        // recall
        const res = await memoriesApi.search(sessionApiKey, {
          query: recallQuery.trim(),
          topK: recallTopK,
          actorId: actorId.trim(),
        });
        setResponseStatus(200);
        setResponseData(res);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Request failed.";
      const code = err instanceof ApiError ? err.status : 500;
      setResponseStatus(code);
      setResponseError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Page Header ── */}
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">Playground</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Developer console · Project:{" "}
          <span className="font-medium text-foreground font-mono">
            {selectedProject?.name ?? "—"}
          </span>
        </p>
      </div>

      {/* ── Notifications ── */}
      <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />

      {!sessionApiKey && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400">
          <Terminal className="h-4 w-4 shrink-0" />
          <span>
            No API key loaded. Visit{" "}
            <a href="/dashboard/api-keys" className="underline hover:text-amber-500 transition-colors">
              API Keys
            </a>{" "}
            to load a session key before executing operations.
          </span>
        </div>
      )}

      {/* ── Console Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Operation Builder */}
        <div className="space-y-4">
          {/* Operation selector */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Operation</div>
            <div className="flex gap-1 p-1 rounded-md border border-border/60 bg-surface-subtle/30 w-fit">
              {OPERATIONS.map((op) => (
                <button
                  key={op.id}
                  onClick={() => setOperation(op.id)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    operation === op.id
                      ? "bg-surface-elevated text-foreground border border-border/60 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">{currentOp.description}</p>
          </div>

          {/* Actor ID (shared) */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> Actor Scope
            </label>
            <input
              type="text"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="user-123"
              className="w-full px-3 py-1.5 text-xs font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Operation-specific inputs */}
          {operation === "remember" ? (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Content</label>
                <textarea
                  rows={4}
                  value={rememberContent}
                  onChange={(e) => setRememberContent(e.target.value)}
                  placeholder="Memory content to store and embed…"
                  className="w-full px-3 py-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-sans leading-relaxed resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Memory Type</label>
                <select
                  value={rememberType}
                  onChange={(e) => setRememberType(e.target.value as MemoryType)}
                  className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {VALID_MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Query</label>
                <textarea
                  rows={3}
                  value={recallQuery}
                  onChange={(e) => setRecallQuery(e.target.value)}
                  placeholder="Natural language query…"
                  className="w-full px-3 py-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-sans leading-relaxed resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Top-K: <span className="text-foreground">{recallTopK}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={recallTopK}
                  onChange={(e) => setRecallTopK(Number(e.target.value))}
                  className="w-full cursor-pointer accent-primary"
                />
              </div>
            </>
          )}

          {/* Execute button */}
          <Button
            onClick={handleExecute}
            disabled={isExecuting || !sessionApiKey}
            className="w-full gap-2 text-xs"
            size="sm"
          >
            {isExecuting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Executing…</>
            ) : (
              <><Play className="h-3.5 w-3.5" />Execute {currentOp.label}</>
            )}
          </Button>
        </div>

        {/* Right: Request + Response */}
        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Request</div>
            <RequestPreview
              method={currentOp.method}
              path={currentOp.path}
              body={requestBody}
              hasMaskedKey={!!sessionApiKey}
            />
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Response</div>
            <ResponseViewer
              status={responseStatus}
              data={responseData}
              error={responseError}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
