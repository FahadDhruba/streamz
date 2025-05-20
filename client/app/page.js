"use client";

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://localhost:4000", { autoConnect: false });

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [userCount, setUserCount] = useState(1);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [hosts, setHosts] = useState(new Set());
  const [remoteMuted, setRemoteMuted] = useState({});

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});

  // Connect and join room
  const joinRoom = async (asHost = false) => {
    if (!roomId) return alert("Enter a room ID");
    socket.connect();

    // Get media
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    localVideoRef.current.srcObject = stream;

    socket.emit("join-room", { roomId, isHost: asHost });
    setJoined(true);
    setIsHost(asHost);
  };

  const leaveRoom = () => {
    Object.values(peersRef.current).forEach(peer => peer.close());
    peersRef.current = {};
    setRemoteStreams({});
    socket.disconnect();
    setJoined(false);
    setIsHost(false);
    setHosts(new Set());
  };

  const createPeer = (userId, initiator) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    localStreamRef.current.getTracks().forEach(track => {
      peer.addTrack(track, localStreamRef.current);
    });

    peer.onicecandidate = e => {
      if (e.candidate) {
        socket.emit("ice-candidate", { to: userId, candidate: e.candidate });
      }
    };

    peer.ontrack = e => {
      setRemoteStreams(prev => ({ ...prev, [userId]: e.streams[0] }));
    };

    if (initiator) {
      peer.createOffer().then(offer => {
        peer.setLocalDescription(offer);
        socket.emit("offer", { to: userId, offer });
      });
    }

    peersRef.current[userId] = peer;
  };

  const handleOffer = async ({ from, offer }) => {
    createPeer(from, false);
    const peer = peersRef.current[from];
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("answer", { to: from, answer });
  };

  const handleAnswer = async ({ from, answer }) => {
    const peer = peersRef.current[from];
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const handleIceCandidate = async ({ from, candidate }) => {
    const peer = peersRef.current[from];
    if (peer) {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMuted(!audioTrack.enabled);
    }
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setVideoOff(!videoTrack.enabled);
    }
  };

  // Host controls
  const kickUser = (userId) => {
    socket.emit("kick-user", { roomId, userId });
  };

  const muteUser = (userId) => {
    socket.emit("mute-user", { roomId, userId });
    setRemoteMuted(prev => ({ ...prev, [userId]: true }));
  };

  const addHost = (userId) => {
    socket.emit("add-host", { roomId, userId });
  };

  const removeHost = (userId) => {
    socket.emit("remove-host", { roomId, userId });
  };

  useEffect(() => {
    // Socket event listeners
    socket.on("user-joined", ({ id, isHost: userIsHost }) => {
      createPeer(id, true);
      if (userIsHost) {
        setHosts(prev => new Set([...prev, id]));
      }
    });

    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);

    socket.on("user-disconnected", userId => {
      if (peersRef.current[userId]) {
        peersRef.current[userId].close();
        delete peersRef.current[userId];
        setRemoteStreams(prev => {
          const updated = { ...prev };
          delete updated[userId];
          return updated;
        });
        setHosts(prev => {
          const updated = new Set(prev);
          updated.delete(userId);
          return updated;
        });
      }
    });

    socket.on("user-count", count => setUserCount(count));

    // Host-specific events
    socket.on("kicked", () => {
      leaveRoom();
      alert("You have been kicked from the room");
    });

    socket.on("remote-mute", () => {
      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        setMuted(true);
      }
    });

    socket.on("host-status", (status) => {
      setIsHost(status);
    });

    socket.on("host-added", (userId) => {
      setHosts(prev => new Set([...prev, userId]));
    });

    socket.on("host-removed", (userId) => {
      setHosts(prev => {
        const updated = new Set(prev);
        updated.delete(userId);
        return updated;
      });
    });

    socket.on("disconnect", () => {
      console.log("Disconnected. Attempting reconnect...");
      setTimeout(() => socket.connect(), 1000);
    });

    return () => {
      socket.off();
    };
  }, []);

  return (
    <main style={{ padding: 20 }}>
      {!joined ? (
        <div>
          <h1>Join a Room</h1>
          <input
            placeholder="Enter Room ID"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
          />
          <button onClick={() => joinRoom(true)}>Join as Host</button>
          <button onClick={() => joinRoom(false)}>Join as Participant</button>
          <button onClick={() => setRoomId(crypto.randomUUID().slice(0, 8))}>Generate ID</button>
        </div>
      ) : (
        <div>
          <h2>Room: {roomId}</h2>
          <p>Users in room: {userCount}</p>
          <p>Status: {isHost ? "Host" : "Participant"}</p>
          <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
          <button onClick={toggleVideo}>{videoOff ? "Turn Camera On" : "Turn Camera Off"}</button>
          <button onClick={leaveRoom}>Disconnect</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "20px" }}>
        {/* Local video - full screen if host */}
        <div style={{ width: isHost ? "100%" : "300px" }}>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              maxHeight: isHost ? "70vh" : "300px",
              objectFit: "cover"
            }}
          />
        </div>

        {/* Remote streams grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "20px"
        }}>
          {Object.entries(remoteStreams).map(([id, stream]) => (
            <div key={id} style={{ position: "relative" }}>
              <video
                autoPlay
                playsInline
                ref={video => video && (video.srcObject = stream)}
                style={{ width: "100%", maxHeight: "300px", objectFit: "cover" }}
              />
              {isHost && (
                <div style={{ position: "absolute", bottom: "10px", right: "10px", display: "flex", gap: "10px" }}>
                  <button onClick={() => kickUser(id)}>Kick</button>
                  <button onClick={() => muteUser(id)}>Mute</button>
                  {!hosts.has(id) ? (
                    <button onClick={() => addHost(id)}>Make Host</button>
                  ) : (
                    <button onClick={() => removeHost(id)}>Remove Host</button>
                  )}
                </div>
              )}
              {remoteMuted[id] && (
                <div style={{
                  position: "absolute",
                  top: "10px",
                  left: "10px",
                  background: "rgba(0,0,0,0.5)",
                  color: "white",
                  padding: "5px"
                }}>
                  Muted
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
