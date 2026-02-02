// 工具: 文本与字节转换
function strToUint8(str) {
  return new TextEncoder().encode(str);
}
function uint8ToStr(buf) {
  return new TextDecoder().decode(buf);
}
function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function fromBase64(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", strToUint8(input));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// 使用 PBKDF2 从口令派生 AES-GCM 密钥
async function deriveAesKey(passphrase, roomId) {
  const saltHex = await sha256Hex("room:" + roomId); // 教学演示：以房间ID派生salt
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(h => parseInt(h, 16)));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    strToUint8(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 120000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function exportKeyFingerprint(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  // 取前后各8位展示
  return hex.slice(0, 8) + "…" + hex.slice(-8);
}

async function encryptAesGcm(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    strToUint8(plaintext)
  );
  return {
    iv: toBase64(iv),
    ct: toBase64(ct),
  };
}

async function decryptAesGcm(key, ivB64, ctB64) {
  try {
    const iv = new Uint8Array(fromBase64(ivB64));
    const ct = fromBase64(ctB64);
    
    // AES-GCM 解密会自动验证完整性（认证标签）
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ct
    );
    return { success: true, plaintext: uint8ToStr(pt) };
  } catch (error) {
    // 解密失败可能的原因：
    // 1. 密钥不匹配（不同口令）
    // 2. 消息被篡改（完整性验证失败）
    // 3. IV 或密文格式错误
    return { 
      success: false, 
      error: error.name,
      message: error.message 
    };
  }
}

// UI逻辑
const els = {
  roomId: document.getElementById("roomId"),
  nickname: document.getElementById("nickname"),
  passphrase: document.getElementById("passphrase"),
  btnJoin: document.getElementById("btnJoin"),
  btnLeave: document.getElementById("btnLeave"),
  keyFingerprint: document.getElementById("keyFingerprint"),
  chatSection: document.getElementById("chatSection"),
  messages: document.getElementById("messages"),
  messageInput: document.getElementById("messageInput"),
  btnSend: document.getElementById("btnSend"),
};

let socket = null;
let roomKey = null;
let currentRoomId = null;
let currentNickname = null;

function addMessage({ meta, text, system, encryptionStatus, isError }) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg" + (system ? " system" : "") + (isError ? " error" : "");
  const metaEl = document.createElement("div");
  metaEl.className = "meta";
  
  // 添加加密状态指示器
  let statusIcon = "";
  let statusText = "";
  let statusClass = "";
  if (encryptionStatus) {
    if (encryptionStatus === "encrypted") {
      statusIcon = "🔒";
      statusText = "已加密";
      statusClass = "status-encrypted";
    } else if (encryptionStatus === "verified") {
      statusIcon = "🔒";
      statusText = "已验证";
      statusClass = "status-verified";
    } else if (encryptionStatus === "failed") {
      statusIcon = "⚠️";
      statusText = "解密失败";
      statusClass = "status-failed";
    }
  }
  
  if (statusIcon) {
    const statusSpan = document.createElement("span");
    statusSpan.className = `encryption-status ${statusClass}`;
    statusSpan.textContent = `${statusIcon} ${statusText}`;
    metaEl.innerHTML = `${meta} | `;
    metaEl.appendChild(statusSpan);
  } else {
    metaEl.textContent = meta;
  }
  
  const textEl = document.createElement("div");
  textEl.className = "text";
  textEl.textContent = text;
  wrapper.appendChild(metaEl);
  wrapper.appendChild(textEl);
  els.messages.appendChild(wrapper);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function isoNow() {
  return new Date().toISOString();
}

async function joinRoom() {
  const roomId = els.roomId.value.trim();
  const nickname = els.nickname.value.trim() || "匿名";
  const passphrase = els.passphrase.value;
  if (!roomId || !passphrase) {
    alert("请填写房间ID与口令");
    return;
  }
  currentRoomId = roomId;
  currentNickname = nickname;
  roomKey = await deriveAesKey(passphrase, roomId);
  els.keyFingerprint.textContent = await exportKeyFingerprint(roomKey);

  if (!socket) {
    socket = io();
    socket.on("connect", () => {});
    socket.on("system", (data) => {
      if (data.type === "join") {
        addMessage({
          meta: `[系统] ${data.timestamp}`,
          text: `${data.nickname} 加入了房间`,
          system: true,
        });
      } else if (data.type === "leave") {
        addMessage({
          meta: `[系统] ${data.timestamp}`,
          text: `${data.nickname} 离开了房间`,
          system: true,
        });
      }
    });
    socket.on("join_success", (data) => {
      // 加入成功，隐藏错误提示
      hideError();
      // 显示聊天区域
      els.chatSection.style.display = "";
      els.btnJoin.disabled = true;
      els.btnLeave.disabled = false;
      els.roomId.disabled = true;
      els.passphrase.disabled = true;
      // 显示成功消息
      addMessage({
        meta: `[系统] ${isoNow()}`,
        text: `成功加入房间（${data.currentSize}/${data.maxSize}）`,
        system: true,
      });
    });
    socket.on("join_error", (data) => {
      // 加入失败，显示错误提示
      showError(data.message, data.code);
      // 恢复UI状态
      els.chatSection.style.display = "none";
      els.btnJoin.disabled = false;
      els.btnLeave.disabled = true;
      els.roomId.disabled = false;
      els.passphrase.disabled = false;
      // 清理状态
      currentRoomId = null;
      currentNickname = null;
      roomKey = null;
      els.keyFingerprint.textContent = "未就绪";
    });
    socket.on("chat_message", async (data) => {
      if (data.roomId !== currentRoomId) return;
      
      const result = await decryptAesGcm(roomKey, data.payload.iv, data.payload.ct);
      
      if (result.success) {
        // 解密成功，完整性验证通过
        addMessage({
          meta: `[${data.nickname}] ${data.timestamp}`,
          text: result.plaintext,
          system: false,
          encryptionStatus: "verified",
        });
      } else {
        // 解密失败，显示明确的错误提示
        let errorReason = "未知错误";
        if (result.error === "OperationError" || result.error === "InvalidAccessError") {
          errorReason = "密钥不匹配或消息被篡改";
        } else if (result.error === "DataError") {
          errorReason = "消息格式错误";
        }
        
        addMessage({
          meta: `[${data.nickname}] ${data.timestamp}`,
          text: `⚠️ 无法解密此消息\n原因: ${errorReason}\n可能情况:\n• 使用了不同的房间口令\n• 消息在传输过程中被篡改\n• 加密数据损坏`,
          system: false,
          encryptionStatus: "failed",
          isError: true,
        });
      }
    });
  }

  socket.emit("join_room", { roomId, nickname });
}

function leaveRoom() {
  if (socket && currentRoomId) {
    socket.emit("leave_room", { roomId: currentRoomId, nickname: currentNickname });
  }
  currentRoomId = null;
  currentNickname = null;
  roomKey = null;
  els.keyFingerprint.textContent = "未就绪";
  els.chatSection.style.display = "none";
  els.btnJoin.disabled = false;
  els.btnLeave.disabled = true;
  els.roomId.disabled = false;
  els.passphrase.disabled = false;
}

async function sendMessage() {
  if (!socket || !currentRoomId || !roomKey) return;
  const text = els.messageInput.value;
  if (!text.trim()) return;
  const payload = await encryptAesGcm(roomKey, text);
  const msg = {
    roomId: currentRoomId,
    nickname: currentNickname,
    timestamp: isoNow(),
    payload, // { iv, ct } base64
  };
  // 自己本地显示明文（避免等待回环），标记为已加密
  addMessage({
    meta: `[我] ${msg.timestamp}`,
    text,
    system: false,
    encryptionStatus: "encrypted",
  });
  els.messageInput.value = "";
  socket.emit("chat_message", msg);
}

function showError(message, code) {
  const errorAlert = document.getElementById("errorAlert");
  const errorMessage = document.getElementById("errorMessage");
  errorMessage.textContent = message;
  errorAlert.style.display = "flex";
  // 5秒后自动隐藏
  setTimeout(hideError, 5000);
}

function hideError() {
  const errorAlert = document.getElementById("errorAlert");
  errorAlert.style.display = "none";
}

els.btnJoin.addEventListener("click", joinRoom);
els.btnLeave.addEventListener("click", leaveRoom);
els.btnSend.addEventListener("click", sendMessage);
els.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});


