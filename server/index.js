const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Adjust if needed
    methods: ["GET", "POST"]
  }
});

// Store room hosts
const roomHosts = new Map();

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId, isHost }) => {
    socket.join(roomId);
    socket.roomId = roomId;

    // Set host if specified
    if (isHost) {
      if (!roomHosts.has(roomId)) {
        roomHosts.set(roomId, new Set());
      }
      roomHosts.get(roomId).add(socket.id);
      socket.isHost = true;
    }

    // Notify existing peers
    socket.to(roomId).emit("user-joined", { id: socket.id, isHost: socket.isHost });

    // Update user count in room
    const count = io.sockets.adapter.rooms.get(roomId)?.size || 1;
    io.to(roomId).emit("user-count", count);
  });

  socket.on("offer", ({ to, offer }) => {
    io.to(to).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ to, answer }) => {
    io.to(to).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // Host-specific events
  socket.on("kick-user", ({ roomId, userId }) => {
    if (roomHosts.get(roomId)?.has(socket.id)) {
      io.to(userId).emit("kicked");
      io.to(roomId).emit("user-kicked", userId);
    }
  });

  socket.on("mute-user", ({ roomId, userId }) => {
    if (roomHosts.get(roomId)?.has(socket.id)) {
      io.to(userId).emit("remote-mute");
    }
  });

  socket.on("add-host", ({ roomId, userId }) => {
    if (roomHosts.get(roomId)?.has(socket.id)) {
      if (!roomHosts.has(roomId)) {
        roomHosts.set(roomId, new Set());
      }
      roomHosts.get(roomId).add(userId);
      io.to(userId).emit("host-status", true);
      io.to(roomId).emit("host-added", userId);
    }
  });

  socket.on("remove-host", ({ roomId, userId }) => {
    if (roomHosts.get(roomId)?.has(socket.id)) {
      roomHosts.get(roomId).delete(userId);
      io.to(userId).emit("host-status", false);
      io.to(roomId).emit("host-removed", userId);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    const roomId = socket.roomId;
    if (roomId) {
      // Remove from hosts if they were a host
      if (roomHosts.get(roomId)?.has(socket.id)) {
        roomHosts.get(roomId).delete(socket.id);
        if (roomHosts.get(roomId).size === 0) {
          roomHosts.delete(roomId);
        }
      }

      socket.to(roomId).emit("user-disconnected", socket.id);

      // Update user count
      const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      io.to(roomId).emit("user-count", count);
    }
  });
});

server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
