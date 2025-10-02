// server.js
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.resolve(__dirname, 'public'), { extensions: ['html'] }));

app.use(express.json());

// Optional: a simple index so GET / works on Render health checks
app.get('/', (_req, res) => {
  res.type('html').send(`
    <h2>WebRTC Demo</h2>
    <ul>
      <li><a href="/agent.html">Agent</a></li>
      <li><a href="/caller.html">Caller</a></li>
    </ul>
  `);
});

// In-memory agent registry: { socketId: { name, available, busy } }
const agents = new Map();

function currentAgents() {
  return [...agents.entries()].map(([id, a]) => ({
    id,
    name: a.name,
    available: !!a.available && !a.busy
  }));
}
function broadcastAgents() {
  const list = currentAgents();
  console.log('[server] broadcast agents', list);
  io.emit('agents:list', list);
}
function sendAgentsList(sock) {
  const list = currentAgents();
  console.log('[server] send list to', sock.id, list);
  sock.emit('agents:list', list);
}

// --- Debug endpoint so you can verify server state in the browser ---
app.get('/api/debug/agents', (_req, res) => res.json(currentAgents()));

io.on('connection', (socket) => {
  console.log('[server] socket connected', socket.id);

  // Push current list to this client immediately
  sendAgentsList(socket);

  // Allow clients to request the list explicitly
  socket.on('agents:request', () => sendAgentsList(socket));

  // === Agent lifecycle ===
  socket.on('agent:register', ({ name }) => {
    const n = (name || 'Agent').trim();
    agents.set(socket.id, { name: n, available: true, busy: false });
    console.log('[server] agent registered', socket.id, n);
    socket.join('agents');
    broadcastAgents();
  });

  socket.on('agent:setAvailable', (available) => {
    const a = agents.get(socket.id);
    if (a) a.available = !!available;
    console.log('[server] agent availability', socket.id, !!available);
    broadcastAgents();
  });

  // === Calls ===
  socket.on('call:place', ({ agentId, offer, callerName }) => {
    const agent = agents.get(agentId);
    if (!agent) {
      console.warn('[server] call error: agent not found', agentId);
      socket.emit('call:error', { reason: 'Agent not found or disconnected.' });
      return;
    }
    if (!agent.available || agent.busy) {
      console.warn('[server] call error: agent unavailable', agentId);
      socket.emit('call:error', { reason: 'Agent is not available.' });
      return;
    }
    agent.busy = true;
    broadcastAgents();

    const callId = `${socket.id}_${agentId}`;
    socket.join(callId);
    const agentSock = io.sockets.sockets.get(agentId);
    if (agentSock) agentSock.join(callId);

    io.to(agentId).emit('call:incoming', {
      callId,
      fromSocketId: socket.id,
      callerName: callerName || 'Caller',
      offer
    });
    socket.emit('call:ringing', { callId, agentName: agent.name });
  });

  socket.on('call:accept', ({ callId, answer }) => {
    socket.to(callId).emit('call:accepted', { answer });
  });

  socket.on('call:decline', ({ callId, reason }) => {
    socket.to(callId).emit('call:declined', { reason: reason || 'Declined' });
    const a = agents.get(socket.id);
    if (a) { a.busy = false; broadcastAgents(); }
    io.socketsLeave(callId);
  });

  socket.on('webrtc:ice', ({ callId, candidate }) => {
    socket.to(callId).emit('webrtc:ice', { candidate });
  });

  socket.on('call:hangup', ({ callId }) => {
    socket.to(callId).emit('call:hangup');
    io.socketsLeave(callId);
    const a = agents.get(socket.id);
    if (a) { a.busy = false; broadcastAgents(); }
  });

  socket.on('disconnect', () => {
    if (agents.has(socket.id)) {
      console.log('[server] agent disconnected', socket.id);
      agents.delete(socket.id);
      broadcastAgents();
    } else {
      console.log('[server] socket disconnected', socket.id);
    }
  });
});

http.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
