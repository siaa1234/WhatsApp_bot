const fs = require("fs")
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys")
const P = require("pino")

// 👉 SESSION ID EKA ME THANATA
const SESSION_ID = "ASITHA-MD=7694a6b0f36083ef"

async function start() {
  if (!fs.existsSync('./auth')) fs.mkdirSync('./auth')

  // Session ID eka creds.json karanawa
  if (SESSION_ID.includes("~") &&!fs.existsSync('./auth/creds.json')) {
    let b64 = SESSION_ID.split("~")[1]
    fs.writeFileSync('./auth/creds.json', Buffer.from(b64, 'base64'))
  }

  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    browser: ["Chrome", "Chrome", "110.0"]
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u
    if (connection === "open") console.log("✅ CONNECTED")
    if (connection === "close" && lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) start()
  })

  // 👉 AUTO REPLY MESSAGE
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0]
    if (!msg.message || msg.key.fromMe) return
    await sock.sendMessage(msg.key.remoteJid, { text: "Have a nice day! 💖 Mama dan busy." })
  })

  // 👉 AUTO CALL BLOCK
  sock.ev.on("call", async (c) => {
    for (let call of c) {
      if (call.status === "offer") await sock.rejectCall(call.id, call.from)
    }
  })
}
start()
