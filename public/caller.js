// public/caller.js
const socket = io();
socket.on('connect', () => {
  console.log('[caller] connected', socket.id);
  socket.emit('agents:request');     // ask once on load
});
let pc = null;
let localStream = null;
let currentCallId = null;

const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const $ = (s) => document.querySelector(s);
const callerName = $('#callerName');
const agentSelect = $('#agentSelect');
const callBtn = $('#callBtn');
const hangupBtn = $('#hangupBtn');
const status = $('#status');
const remoteAudio = $('#remoteAudio');

const callerRingtone = document.getElementById('callerRingtone');

function startCallerRingtone() {
  try { callerRingtone.currentTime = 0; callerRingtone.play(); } catch (e) {}
}
function stopCallerRingtone() {
  try { callerRingtone.pause(); callerRingtone.currentTime = 0; } catch (e) {}
}

socket.on('agents:list', (list) => {
  console.log(list)
  agentSelect.innerHTML = '';
  const available = list.filter(a => a.available);
  if (!available.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No agents available';
    agentSelect.appendChild(opt);
    callBtn.disabled = true;
    return;
  }
  callBtn.disabled = false;
  available.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    agentSelect.appendChild(opt);
  });
});

callBtn.onclick = async () => {
  const agentId = agentSelect.value;
  if (!agentId) return;
  callBtn.disabled = true; hangupBtn.disabled = false;
  status.textContent = 'Setting up local audio…';

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  pc = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate && currentCallId) {
      socket.emit('webrtc:ice', { callId: currentCallId, candidate: e.candidate });
    }
  };
  pc.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  status.textContent = 'Calling agent…';
  socket.emit('call:place', { agentId, offer, callerName: callerName.value || 'Caller' });
  startCallerRingtone();
};

socket.on('call:ringing', ({ callId, agentName }) => {
  currentCallId = callId;
  status.textContent = `Ringing ${agentName}…`;
});

socket.on('call:accepted', async ({ answer }) => {
  stopCallerRingtone(); 
  status.textContent = 'Connected.';
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('call:declined', ({ reason }) => {
  stopCallerRingtone(); 
  status.textContent = `Call declined: ${reason || ''}`;
  cleanup();
});

socket.on('call:error', ({ reason }) => {
  stopCallerRingtone(); 
  status.textContent = `Call error: ${reason}`;
  cleanup();
});

socket.on('webrtc:ice', async ({ candidate }) => {
  try { await pc?.addIceCandidate(candidate); } catch (e) { console.error('ICE add error', e); }
});

socket.on('call:hangup', () => {
  stopCallerRingtone(); 
  status.textContent = 'Call ended by remote.';
  cleanup();
});

hangupBtn.onclick = () => {
  if (!currentCallId) return;
  socket.emit('call:hangup', { callId: currentCallId });
  stopCallerRingtone(); 
  status.textContent = 'Call ended.';
  cleanup();
};

function cleanup() {
  callBtn.disabled = false; hangupBtn.disabled = true; currentCallId = null;
  try { pc?.getSenders().forEach(s => s.track?.stop()); } catch {}
  try { pc?.close(); } catch {}
  pc = null;
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
}
