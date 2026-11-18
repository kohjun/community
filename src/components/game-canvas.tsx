"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Eraser, PenLine, Undo2, Trash2, Wifi, LoaderCircle } from "lucide-react";
import { appRequest } from "@/lib/api-client";
import { paintInk, replayInk, type InkCommand, type InkEvent } from "@/domain/game-ink";
import styles from "./creative-games.module.css";
export type CanvasHandle = { image: () => Promise<Blob> };
export const GameCanvas = forwardRef<
  CanvasHandle,
  { roomId: string; host: boolean; phaseId: string; canvasId: string; editable: boolean }
>(function GameCanvas({ roomId, host, phaseId, canvasId, editable }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null),
    events = useRef<InkEvent[]>([]),
    queue = useRef<InkCommand[]>([]),
    inflight = useRef<{ seq: number; command: InkCommand } | null>(null),
    nextSeq = useRef(1),
    socket = useRef<WebSocket | null>(null),
    stroke = useRef<{ id: string; points: [number, number][] } | null>(null),
    active = useRef<number | null>(null);
  const [colour, setColour] = useState("#111827"),
    [width, setWidth] = useState(4),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("그림판에 연결하고 있어요.");
  const draw = () => {
    const c = canvas.current,
      ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const future = [...events.current];
    let seq = future.at(-1)?.seq ?? 0;
    if (inflight.current && inflight.current.seq > seq) {
      future.push(inflight.current);
      seq = inflight.current.seq;
    }
    for (const command of queue.current) future.push({ seq: ++seq, command });
    if (stroke.current?.points.length)
      future.push({
        seq: ++seq,
        command: {
          op: "stroke",
          id: stroke.current.id,
          points: [...stroke.current.points],
          colour: colour as "#111827",
          width,
        },
      });
    paintInk(ctx, replayInk(future), c.width, c.height);
  };
  const render = useRef(draw);
  render.current = draw;
  const add = (command: InkCommand) => {
    queue.current.push(command);
    render.current();
  };
  const flush = () => {
    if (!stroke.current?.points.length) return;
    if (stroke.current?.points.length) {
      queue.current.push({
        op: "stroke",
        id: stroke.current.id,
        points: stroke.current.points.splice(0, 128),
        colour: colour as "#111827",
        width,
      });
    }
    render.current();
  };
  const flushing = useRef(flush);
  flushing.current = flush;
  useImperativeHandle(
    ref,
    () => ({
      image: () =>
        new Promise((resolve, reject) => {
          flushing.current();
          const c = canvas.current;
          if (!c) {
            reject(new Error("그림판을 확인해주세요."));
            return;
          }
          c.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("그림을 저장하지 못했어요."))),
            "image/webp",
            0.85,
          );
        }),
    }),
    [],
  );
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const resize = () => {
      c.width = 800;
      c.height = 600;
      render.current();
    };
    resize();
  }, [canvasId]);
  useEffect(() => {
    let live = true,
      retry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    events.current = [];
    queue.current = [];
    inflight.current = null;
    nextSeq.current = 1;
    setReady(false);
    render.current();
    const connect = async () => {
      if (!live) return;
      setMessage("그림판에 연결하고 있어요.");
      try {
        const info = await appRequest<{ ticket: string; url: string }>(
          `/api/games/${roomId}/ink${host ? "?host=1" : ""}`,
          "POST",
          {},
          controller.signal,
        );
        if (!live) return;
        const ws = new WebSocket(info.url);
        socket.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: "auth", ticket: info.ticket }));
        ws.onmessage = (event) => {
          if (!live) return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          if (data.canvas && data.canvas !== canvasId) return;
          if (data.type === "snapshot") {
            events.current = data.events;
            nextSeq.current = (events.current.at(-1)?.seq ?? 0) + 1;
            inflight.current = null;
            queue.current = [];
          }
          if (data.type === "ink" && data.event.seq > (events.current.at(-1)?.seq ?? 0))
            events.current.push(data.event);
          if (data.type === "ack" && inflight.current && inflight.current.seq === data.seq) {
            if (data.seq > (events.current.at(-1)?.seq ?? 0)) events.current.push(inflight.current);
            inflight.current = null;
          }
          if (data.type === "ready") {
            setReady(true);
            setMessage(
              editable
                ? "자동 저장 중 · 손가락이나 펜으로 그려보세요."
                : "실시간으로 그려지는 모습을 보고 있어요.",
            );
          }
          if (data.type === "limit") {
            setReady(false);
            inflight.current = null;
            queue.current = [];
            stroke.current = null;
            setMessage(data.message);
          }
          render.current();
        };
        ws.onclose = () => {
          if (!live) return;
          setReady(false);
          setMessage("다시 연결하고 있어요. 저장된 그림을 복원할게요.");
          retry = setTimeout(() => void connect(), 1000);
        };
        ws.onerror = () => ws.close();
      } catch (e) {
        if (!live) return;
        setReady(false);
        setMessage(e instanceof Error ? e.message : "연결을 확인해주세요.");
        retry = setTimeout(() => void connect(), 3000);
      }
    };
    void connect();
    const interval = setInterval(() => {
      flushing.current();
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || inflight.current || !queue.current.length)
        return;
      const command = queue.current.shift()!,
        seq = nextSeq.current++;
      inflight.current = { seq, command };
      ws.send(JSON.stringify({ type: "ink", canvas: canvasId, seq, command }));
    }, 120);
    return () => {
      live = false;
      controller.abort();
      clearInterval(interval);
      clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [roomId, host, phaseId, canvasId, editable]);
  function point(e: PointerEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  }
  return (
    <div className={styles.canvasWrap}>
      {editable && (
        <div className={styles.toolbar} role="group" aria-label="그림 도구">
          {["#111827", "#0A84FE", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6"].map((c) => (
            <button
              type="button"
              className={styles.tool}
              key={c}
              disabled={!ready}
              aria-label={`펜 색상 ${{ "#111827": "검정", "#0A84FE": "파랑", "#ef4444": "빨강", "#f59e0b": "주황", "#22c55e": "초록", "#8b5cf6": "보라" }[c]}`}
              aria-pressed={colour === c}
              onClick={() => {
                flushing.current();
                setColour(c);
              }}
            >
              <span className={styles.colour} style={{ background: c }} />
            </button>
          ))}
          <button
            type="button"
            className={styles.tool}
            aria-label="지우개"
            aria-pressed={colour === "#ffffff"}
            onClick={() => {
              flushing.current();
              setColour("#ffffff");
            }}
          >
            <Eraser size={17} />
          </button>
          <button
            type="button"
            className={styles.tool}
            aria-label={`펜 굵기 ${width}`}
            onClick={() => {
              flushing.current();
              setWidth((v) => (v === 4 ? 10 : v === 10 ? 20 : 4));
            }}
          >
            <PenLine size={18} />
          </button>
          <button
            type="button"
            className={styles.tool}
            disabled={!ready}
            aria-label="마지막 선 되돌리기"
            onClick={() => {
              flushing.current();
              add({ op: "undo" });
            }}
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            className={styles.tool}
            disabled={!ready}
            aria-label="그림 전체 지우기"
            onClick={() => {
              if (confirm("지금 그린 그림을 모두 지울까요?")) {
                stroke.current = null;
                add({ op: "clear" });
              }
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      )}
      <canvas
        ref={canvas}
        className={styles.canvas}
        data-editable={editable && ready}
        aria-label={editable ? "손가락 또는 마우스로 그리는 그림판" : "실시간 그림"}
        width={800}
        height={600}
        onPointerDown={(e) => {
          if (!editable || !ready || active.current !== null) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          active.current = e.pointerId;
          stroke.current = { id: crypto.randomUUID(), points: [point(e)] };
          render.current();
        }}
        onPointerMove={(e) => {
          if (active.current !== e.pointerId || !stroke.current) return;
          const p = point(e),
            last = stroke.current.points.at(-1);
          if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.0015)
            stroke.current.points.push(p);
          if (stroke.current.points.length >= 128) flushing.current();
          render.current();
        }}
        onPointerUp={(e) => {
          if (active.current !== e.pointerId) return;
          flushing.current();
          stroke.current = null;
          active.current = null;
          render.current();
        }}
        onPointerCancel={() => {
          flushing.current();
          stroke.current = null;
          active.current = null;
        }}
      />
      <div className={styles.connection} data-ready={ready} role="status">
        {ready ? <Wifi size={13} /> : <LoaderCircle size={13} />} {message}
      </div>
    </div>
  );
});
