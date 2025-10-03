// public/agent.js
const socket = io();
let pc = null;
let localStream = null;
let currentCallId = null;
let lastIncomingOffer = null;

const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const $ = (s) => document.querySelector(s);
const agentNameInput = $('#agentName');
const registerBtn = $('#registerBtn');
const toggleAvailBtn = $('#toggleAvailBtn');
const statusBadge = $('#status');
const incomingDiv = $('#incoming');
const acceptBtn = $('#acceptBtn');
const declineBtn = $('#declineBtn');
const hangupBtn = $('#hangupBtn');
const remoteAudio = $('#remoteAudio');

const agentRingtone = document.getElementById('agentRingtone');
const inCallControls = document.getElementById('inCallControls');
const muteBtn = document.getElementById('muteBtn');
const unmuteBtn = document.getElementById('unmuteBtn');

function startAgentRingtone() {
  try { agentRingtone.currentTime = 0; agentRingtone.play(); } catch (e) {}
}
function stopAgentRingtone() {
  try { agentRingtone.pause(); agentRingtone.currentTime = 0; } catch (e) {}
}
function showInCallControls(show) {
  inCallControls.style.display = show ? 'flex' : 'none';
  muteBtn.disabled = !show;
  unmuteBtn.disabled = !show;
  hangupBtn.disabled = !show;
}

let isRegistered = false;

registerBtn.onclick = () => {
  console.log('[agent] Go Online clicked');
  socket.emit('agent:register', { name: agentNameInput.value || 'Agent' });
  

  if (isRegistered) return;
//   socket.emit('agent:register', { name: agentNameInput.value || 'Agent' });
  isRegistered = true;
  statusBadge.textContent = 'online (available)';
  toggleAvailBtn.disabled = false;
  registerBtn.disabled = true;
};

toggleAvailBtn.onclick = () => {
  const currentlyAvailable = statusBadge.textContent.includes('available');
  const next = !currentlyAvailable;
  socket.emit('agent:setAvailable', next);
  statusBadge.textContent = next ? 'online (available)' : 'online (unavailable)';
};

// --- Socket handlers ---
socket.on('call:incoming', ({ callId, callerName, offer }) => {
  console.log('[agent] incoming call event')
  currentCallId = callId;
  lastIncomingOffer = offer;
  incomingDiv.textContent = `Call from ${callerName || 'Caller'}`;
  acceptBtn.disabled = false;
  declineBtn.disabled = false;
  showInCallControls(false);     // controls appear after accept
  startAgentRingtone(); 
});

socket.on('webrtc:ice', async ({ candidate }) => {
  try { await pc?.addIceCandidate(candidate); } catch (e) { console.error('ICE add error', e); }
});

socket.on('connect', () => console.log('[agent] connected', socket.id));


socket.on('call:hangup', () => {
  resetCallState();
});

// --- Buttons ---
acceptBtn.onclick = async () => {
  if (!currentCallId || !lastIncomingOffer) return;
  acceptBtn.disabled = true; declineBtn.disabled = true; hangupBtn.disabled = false;
  stopAgentRingtone();
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  pc = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc:ice', { callId: currentCallId, candidate: e.candidate });
  };
  pc.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };

  await pc.setRemoteDescription(new RTCSessionDescription(lastIncomingOffer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('call:accept', { callId: currentCallId, answer });
  showInCallControls(true); 
};
pc.ontrack = (e) => {
  const el = document.getElementById('remoteAudio');
  if (el) {
    el.srcObject = e.streams[0];
  } else {
    console.warn('[agent] remoteAudio element not found when ontrack fired');
  }
};

declineBtn.onclick = () => {
  if (!currentCallId) return;
  socket.emit('call:decline', { callId: currentCallId, reason: 'Agent declined' });
  stopAgentRingtone();  
  resetCallState();
};

hangupBtn.onclick = () => {
  if (!currentCallId) return;
  socket.emit('call:hangup', { callId: currentCallId });
  stopAgentRingtone();  
  resetCallState();
};

muteBtn.onclick = () => {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = false);
  muteBtn.disabled = true;
  unmuteBtn.disabled = false;
};
unmuteBtn.onclick = () => {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = true);
  muteBtn.disabled = false;
  unmuteBtn.disabled = true;
};
// --- Helpers ---
function resetCallState() {
  incomingDiv.textContent = 'No calls yet.';
  acceptBtn.disabled = true; declineBtn.disabled = true; hangupBtn.disabled = true;
   showInCallControls(false);
  lastIncomingOffer = null; currentCallId = null;
  try { pc?.getSenders().forEach(s => s.track?.stop()); } catch {}
  try { pc?.close(); } catch {}
  pc = null;
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  stopAgentRingtone();
}
