"use client";
import { useEffect, useRef, useState } from "react";
import { appRequest, RequestError } from "./api-client";
import { appendCrewPage } from "./crew-client";
import type {
  CrewDetail,
  CrewEvent,
  CrewActivity,
  CrewContribution,
  CrewJoinRequest,
  CrewPage,
} from "@/domain/crew";

export function useCrew(initial: CrewDetail, initialCanWrite: boolean) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [canWrite, setCanWrite] = useState(initialCanWrite),
    [available, setAvailable] = useState<CrewEvent[] | null>(null);
  const epoch = useRef(0),
    gate = useRef(false),
    mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const base = "/api/crews/" + initial.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
      pending.current?.abort();
    };
  }, []);
  function begin() {
    if (gate.current) return null;
    gate.current = true;
    const version = ++epoch.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    return { version, controller };
  }
  function current(token: { version: number; controller: AbortController }) {
    return mounted.current && token.version === epoch.current && !token.controller.signal.aborted;
  }
  function failed(cause: unknown) {
    if (
      cause instanceof RequestError &&
      ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
    ) {
      // Drop private manager data immediately while the next full refresh checks current access.
      setAvailable(null);
      setData((value) => ({ ...value, myRole: null, requests: null }));
      if (cause.code === "UNAUTHENTICATED") setCanWrite(false);
    }
    setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했어요.");
  }
  function finish(token: { version: number; controller: AbortController }) {
    if (current(token)) {
      gate.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const token = begin();
    if (!token) return false;
    try {
      const next = await appRequest<CrewDetail>(base, "GET", undefined, token.controller.signal);
      if (!current(token)) return false;
      setData(next);
      if (!next.myRole || !["owner", "manager"].includes(next.myRole) || next.archived)
        setAvailable(null);
      return true;
    } catch (cause) {
      if (current(token)) failed(cause);
      return false;
    } finally {
      finish(token);
    }
  }
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  async function mutate(
    path: string,
    body: unknown = {},
    method = "POST",
    message = "저장했어요.",
  ) {
    const token = begin();
    if (!token) return false;
    try {
      const next = await appRequest<CrewDetail>(base + path, method, body, token.controller.signal);
      if (!current(token)) return false;
      setData(next);
      setAvailable(null);
      setNotice(message);
      return true;
    } catch (cause) {
      if (current(token)) failed(cause);
      return false;
    } finally {
      finish(token);
    }
  }
  async function more(kind: "activity" | "requests" | "contributions") {
    const page = data[kind];
    if (!page?.nextPage) return;
    const token = begin();
    if (!token) return;
    try {
      const next = await appRequest<CrewPage<CrewActivity | CrewContribution | CrewJoinRequest>>(
        base + "/" + kind + "?page=" + page.nextPage,
        "GET",
        undefined,
        token.controller.signal,
      );
      if (!current(token)) return;
      setData((value) => {
        if (kind === "activity")
          return {
            ...value,
            activity: appendCrewPage(value.activity, next as CrewPage<CrewActivity>),
          };
        if (kind === "contributions")
          return {
            ...value,
            contributions: appendCrewPage(value.contributions, next as CrewPage<CrewContribution>),
          };
        if (!value.requests || !["owner", "manager"].includes(value.myRole ?? "")) return value;
        return {
          ...value,
          requests: appendCrewPage(value.requests, next as CrewPage<CrewJoinRequest>),
        };
      });
    } catch (cause) {
      if (current(token)) failed(cause);
    } finally {
      finish(token);
    }
  }
  async function loadAvailable() {
    const token = begin();
    if (!token) return;
    try {
      const next = await appRequest<{ items: CrewEvent[] }>(
        base + "/events/available",
        "GET",
        undefined,
        token.controller.signal,
      );
      if (current(token)) setAvailable(next.items);
    } catch (cause) {
      if (current(token)) failed(cause);
    } finally {
      finish(token);
    }
  }
  return { data, busy, error, notice, canWrite, available, refresh, mutate, more, loadAvailable };
}
