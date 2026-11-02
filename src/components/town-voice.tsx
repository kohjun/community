"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { appRequest } from "../lib/api-client";
import type { TownSnapshot } from "../domain/town";
import styles from "./town.module.css";
export function TownVoice({
  connected,
  me,
  targets,
  read,
}: {
  connected: boolean;
  me: string | null;
  targets: string[];
  read: () => TownSnapshot | null;
}) {
  const [enabled, setEnabled] = useState(false),
    [active, setActive] = useState(false),
    [muted, setMuted] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const current = useRef<{
      room: import("livekit-client").Room;
      audio: AudioContext;
      nodes: Map<
        string,
        { source: MediaStreamAudioSourceNode; panner: PannerNode; gain: GainNode }
      >;
    } | null>(null),
    latest = useRef({ targets, read });
  latest.current = { targets, read };
  useEffect(() => {
    const c = new AbortController();
    if (connected)
      void appRequest<{ enabled: boolean }>("/api/v1/voice/token", "GET", undefined, c.signal)
        .then((v) => setEnabled(v.enabled))
        .catch(() => {});
    return () => c.abort();
  }, [connected]);
  function stop() {
    epoch.current++;
    const c = current.current;
    current.current = null;
    if (c) {
      void c.room.disconnect();
      for (const n of c.nodes.values()) {
        n.source.disconnect();
        n.panner.disconnect();
        n.gain.disconnect();
      }
      void c.audio.close().catch(() => {});
    }
    setActive(false);
  }
  useEffect(() => {
    if (!connected) stop();
    return () => stop();
  }, [connected, me]);
  useEffect(() => {
    const timer = setInterval(() => {
      const c = current.current;
      if (!c) return;
      const v = latest.current.read(),
        self = v?.players.find((p) => p.id === v.me);
      if (!self) return;
      const at = c.audio.currentTime,
        l = c.audio.listener;
      l.positionX.setValueAtTime(self.x, at);
      l.positionY.setValueAtTime(1.6, at);
      l.positionZ.setValueAtTime(self.z, at);
      l.forwardX.setValueAtTime(Math.sin(self.yaw), at);
      l.forwardY.setValueAtTime(0, at);
      l.forwardZ.setValueAtTime(Math.cos(self.yaw), at);
      l.upY.setValueAtTime(1, at);
      for (const [id, n] of c.nodes) {
        const p = v?.players.find((p) => p.id === id);
        n.gain.gain.setValueAtTime(p && latest.current.targets.includes(id) ? 1 : 0, at);
        if (p) {
          n.panner.positionX.setValueAtTime(p.x, at);
          n.panner.positionY.setValueAtTime(1.6, at);
          n.panner.positionZ.setValueAtTime(p.z, at);
        }
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);
  async function start() {
    if (busy || !connected) return;
    setBusy(true);
    setError("");
    const token = ++epoch.current;
    const audio = new AudioContext();
    void audio.resume();
    try {
      const [{ Room, RoomEvent, Track }, entry] = await Promise.all([
        import("livekit-client"),
        appRequest<{ url: string; token: string }>("/api/v1/voice/token", "POST", {}),
      ]);
      if (token !== epoch.current) {
        await audio.close().catch(() => {});
        return;
      }
      const room = new Room({ adaptiveStream: true });
      const state = {
        room,
        audio,
        nodes: new Map<
          string,
          { source: MediaStreamAudioSourceNode; panner: PannerNode; gain: GainNode }
        >(),
      };
      current.current = state;
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const stream = new MediaStream([track.mediaStreamTrack]),
          source = audio.createMediaStreamSource(stream),
          panner = audio.createPanner(),
          gain = audio.createGain();
        panner.panningModel = "HRTF";
        panner.distanceModel = "linear";
        panner.refDistance = 2;
        panner.maxDistance = 18;
        gain.gain.value = 0;
        source.connect(panner);
        panner.connect(gain);
        gain.connect(audio.destination);
        state.nodes.set(participant.identity, { source, panner, gain });
      });
      room.on(RoomEvent.TrackUnsubscribed, (_t, _p, participant) => {
        const n = state.nodes.get(participant.identity);
        if (n) {
          n.source.disconnect();
          n.panner.disconnect();
          n.gain.disconnect();
          state.nodes.delete(participant.identity);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (current.current === state) stop();
      });
      await room.connect(entry.url, entry.token, { autoSubscribe: false });
      if (token !== epoch.current) {
        await room.disconnect();
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true);
      if (token !== epoch.current) {
        await room.disconnect();
        return;
      }
      setMuted(false);
      setActive(true);
    } catch {
      stop();
      void audio.close().catch(() => {});
      setError("음성에 연결하지 못했어요. 마이크 권한과 연결 상태를 확인해주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.voice}>
      <Volume2 size={15} />
      <span>
        {active
          ? `근접 음성 · 주변 ${targets.length}명`
          : enabled
            ? "가까운 사람과 음성으로 이야기해요"
            : "근접 음성 · 연결 준비 중"}
      </span>
      {active ? (
        <>
          <button
            type="button"
            onClick={() => {
              const c = current.current;
              if (c)
                void c.room.localParticipant
                  .setMicrophoneEnabled(muted)
                  .then(() => setMuted((v) => !v));
            }}
          >
            {muted ? <MicOff size={15} /> : <Mic size={15} />} {muted ? "마이크 켜기" : "음소거"}
          </button>
          <button type="button" onClick={stop}>
            음성 나가기
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={!enabled || !connected || busy}
          onClick={() => void start()}
        >
          <Mic size={15} />
          {busy ? "연결 중…" : "음성 참여"}
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
