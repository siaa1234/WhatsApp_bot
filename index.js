const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys")
const P = require("pino")

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({ auth: state, logger: P({ level: "silent" }) })

  
  const MY_NUMBER = "94762320234"

  if (!sock.authState.creds.registered) {
    let code = await sock.requestPairingCode(MY_NUMBER)
    console.log("PAIR CODE: " + code)
  }

  sock.ev.on("creds.update", saveCreds)

  // Message එකක් ආවම
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    await sock.sendMessage(from, { text: "Have a nice day! 💖\nMama dan busy, passe reply karannam." })
  })

  // Call එකක් ආවම auto reject
  sock.ev.on("call", async (calls) => {
    for (let c of calls) {
      if (c.status === "offer") {
        await sock.rejectCall(c.id, c.from)
        await sock.sendMessage(c.from, { text: "Calls are blocked. Please send a message." })
      }
    }
  })
}
start()
