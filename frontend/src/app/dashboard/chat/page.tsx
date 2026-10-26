"use client";

import React, { useState, useRef, useEffect } from "react";
import { useProject } from "@/providers/project-provider";
import { chatApi } from "@/lib/api/chatApi";
import { ChatProcessingResult } from "@/types/chat";
import { ApiError } from "@/types/api";
import { Button } from "@/components/ui/button";
import { SessionKeyBar } from "@/components/dashboard/session-key-bar";
import { StatusBanner } from "@/components/dashboard/status-banner";
import { LoadingState } from "@/components/dashboard/loading-state";
import {
  MessageSquareCode,
  Play,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  Send,
  ArrowRight,
} from "lucide-react";

export default function ChatProcessingPage() {
  const { selectedProject, sessionApiKey } = useProject();

  const [chatIdInput, setChatIdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ChatProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ingestion State
  const [isIngesting, setIsIngesting] = useState(false);
  const [conversationId, setConversationId] = useState(`conv-${Date.now()}`);
  const [userMessage, setUserMessage] = useState(
    "Hi, I prefer dark mode and TypeScript for all my projects."
  );
  const [assistantMessage, setAssistantMessage] = useState(
    "Got it! I will remember your preference for dark mode and TypeScript."
  );

  // Abort Controllers
  const ingestAbortRef = useRef<AbortController | null>(null);
  const processAbortRef = useRef<AbortController | null>(null);

  // Clear state and cancel in-flight requests on project or key switch
  useEffect(() => {
    ingestAbortRef.current?.abort();
    ingestAbortRef.current = null;
    processAbortRef.current?.abort();
    processAbortRef.current = null;
    setChatIdInput("");
    setResult(null);
    setError(null);
  }, [selectedProject?.projectId, sessionApiKey]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      ingestAbortRef.current?.abort();
      processAbortRef.current?.abort();
    };
  }, []);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionApiKey || !selectedProject) {
      setError("A project API key is required before ingesting conversations.");
      return;
    }
    const capturedProjectId = selectedProject.projectId;
    const capturedKey = sessionApiKey;

    ingestAbortRef.current?.abort();
    const controller = new AbortController();
    ingestAbortRef.current = controller;

    setError(null);
    setIsIngesting(true);
    setResult(null);

    try {
      const now = new Date().toISOString();
      const payload = {
        externalConversationId: conversationId.trim(),
        source: "dashboard-test",
        name: `Test Conversation ${conversationId}`,
        projectId: selectedProject.projectId,
        messages: [
          {
            externalMessageId: `msg-${Date.now()}-1`,
            role: "user",
            content: userMessage.trim(),
            createdAt: now,
          },
          {
            externalMessageId: `msg-${Date.now()}-2`,
            role: "assistant",
            content: assistantMessage.trim(),
            createdAt: now,
          },
        ],
      };

      const res = await chatApi.ingestChat(capturedKey, payload, controller.signal);
      if (
        selectedProject?.projectId === capturedProjectId &&
        sessionApiKey === capturedKey
      ) {
        setChatIdInput(String(res.chatId));
        setConversationId(`conv-${Date.now()}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      if ((err as { name?: string })?.name === "AbortError") return;
      if (
        selectedProject?.projectId === capturedProjectId &&
        sessionApiKey === capturedKey
      ) {
        setError(err instanceof ApiError ? err.message : "Failed to ingest chat conversation.");
      }
    } finally {
      if (
        selectedProject?.projectId === capturedProjectId &&
        sessionApiKey === capturedKey
      ) {
        setIsIngesting(false);
      }
    }
  };

  const handleProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(chatIdInput.trim());
    if (!id || id <= 0) { setError("Provide a valid positive Chat ID."); return; }
    if (!sessionApiKey || !selectedProject) { setError("A project API key is required."); return; }

    const capturedProjectId = selectedProject.projectId;
    const capturedKey = sessionApiKey;

    processAbortRef.current?.abort();
    const controller = new AbortController();
    processAbortRef.current = controller;

    setError(null);
    setIsProcessing(true);
    setResult(null);

    try {
      const data = await chatApi.processChat(capturedKey, id, controller.signal);
      if (
        selectedProject?.projectId === capturedProjectId &&
        sessionApiKey === capturedKey
      ) {
        setResult(data);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      if ((err as { name?: string })?.name === "AbortError") return;
      if (
        selectedProject?.projectId === capturedProjectId &&
        sessionApiKey === capturedKey
      ) {
        setError(err instanceof ApiError ? err.message : "Chat processing failed.");
      }
    } finally {
      if (
        selectedProject?.projectId === capturedProjectId &&
        sessionApiKey === capturedKey
      ) {
        setIsProcessing(false);
      }
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">Chat Pipeline</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Conversation ingestion and memory extraction · Project:{" "}
          <span className="font-medium text-foreground font-mono">
            {selectedProject?.name ?? "—"}
          </span>
        </p>
      </div>

      {/* ── Session Key Bar ── */}
      <SessionKeyBar />

      {/* ── Notifications ── */}
      <StatusBanner type="error" message={error} onDismiss={() => setError(null)} />

      {/* ── Pipeline Steps ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Step 1: Ingest */}
        <div className="border border-border/60 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-surface-subtle/30">
            <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold font-mono border border-primary/20 shrink-0">
              1
            </span>
            <div>
              <div className="text-xs font-semibold text-foreground">Ingest Conversation</div>
              <div className="text-[10px] font-mono text-muted-foreground">Stage Conversation Session</div>
            </div>
          </div>

          <form onSubmit={handleIngest} className="p-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Conversation ID</label>
              <input
                type="text"
                required
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">User Message</label>
              <textarea
                rows={2}
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-sans leading-relaxed resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Assistant Response</label>
              <textarea
                rows={2}
                value={assistantMessage}
                onChange={(e) => setAssistantMessage(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-sans leading-relaxed resize-none"
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={isIngesting || !sessionApiKey || !userMessage.trim()} className="text-xs gap-1.5">
                {isIngesting ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Ingesting…</>
                ) : (
                  <><Send className="h-3.5 w-3.5" />Ingest Conversation</>
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Step 2: Process */}
        <div className="border border-border/60 rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-surface-subtle/30">
            <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold font-mono border border-primary/20 shrink-0">
              2
            </span>
            <div>
              <div className="text-xs font-semibold text-foreground">Trigger Processing</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                Extract & Consolidate Intelligence
              </div>
            </div>
          </div>

          <form onSubmit={handleProcess} className="p-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Target Chat ID</label>
              <input
                type="number"
                required
                placeholder="e.g. 1 (auto-filled from Step 1)"
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground">
                Use the Chat ID returned from Step 1, or enter an existing one.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" size="sm" disabled={isProcessing || !sessionApiKey || !chatIdInput.trim()} className="text-xs gap-1.5">
                {isProcessing ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Processing…</>
                ) : (
                  <><Play className="h-3.5 w-3.5" />Process Chat</>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Result ── */}
      {isProcessing ? (
        <LoadingState message="Executing chat processing pipeline…" />
      ) : result ? (
        <div className="border border-border/60 rounded-lg overflow-hidden animate-in fade-in duration-200">
          {/* Result header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-surface-subtle/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-foreground">
                Chat #{result.chatId} — Processing Complete
              </span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">{result.message}</span>
          </div>

          <div className="p-4 space-y-4">
            {/* Scoped chat guard notice */}
            {result.skipReason && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-md border border-primary/25 bg-primary/5">
                <ShieldAlert className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] font-semibold text-primary mb-0.5">Scoped Chat Guard</div>
                  <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                    {result.skipReason}
                  </p>
                </div>
              </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Extracted", value: result.extractedCount },
                { label: "Created", value: result.createdCount },
                { label: "Skipped", value: result.skippedCount },
              ].map((m) => (
                <div key={m.label} className="border border-border/40 rounded-md p-3 text-center">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{m.label}</div>
                  <div className="text-xl font-bold font-mono text-foreground mt-1">{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
