const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");

let _gmailTransporter = null;

function getGmailTransporter(gmailUser, gmailAppPassword) {
  if (!_gmailTransporter || _gmailTransporter._user !== gmailUser) {
    _gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailAppPassword },
    });
    _gmailTransporter._user = gmailUser;
  }
  return _gmailTransporter;
}

function gmailReadEmails(gmailUser, gmailAppPassword, count = 5) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: gmailUser,
      password: gmailAppPassword,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const results = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.search(["ALL"], (err, uids) => {
          if (err) { imap.end(); return reject(err); }
          if (!uids || uids.length === 0) { imap.end(); return resolve("No emails found."); }

          const latest = uids.slice(-count);
          const f = imap.fetch(latest, { bodies: "", struct: true });

          f.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                results.push({
                  from: parsed.from?.text || "",
                  subject: parsed.subject || "(no subject)",
                  date: parsed.date?.toLocaleString("zh-CN") || "",
                  text: (parsed.text || "").slice(0, 500),
                });
              });
            });
          });

          f.once("end", () => {
            setTimeout(() => {
              imap.end();
              if (results.length === 0) return resolve("No emails parsed.");
              resolve(
                results
                  .map(
                    (r, i) =>
                      `--- Email ${i + 1} ---\nFrom: ${r.from}\nSubject: ${r.subject}\nDate: ${r.date}\n${r.text}`
                  )
                  .join("\n\n")
              );
            }, 1000);
          });
        });
      });
    });

    imap.once("error", (err) => reject(err));
    imap.connect();
  });
}

async function gmailSendEmail(gmailUser, gmailAppPassword, to, subject, body) {
  const transporter = getGmailTransporter(gmailUser, gmailAppPassword);
  const info = await transporter.sendMail({ from: gmailUser, to, subject, text: body });
  return `Email sent successfully. Message ID: ${info.messageId}`;
}

async function executeTool(toolName, args, context) {
  const config = context.config || {};
  const gmailUser = config.gmailUser || "";
  const gmailAppPassword = config.gmailAppPassword || "";

  switch (toolName) {
    case "read_emails": {
      const count = parseInt(args.count) || 5;
      if (!gmailUser || !gmailAppPassword) return "Error: Gmail credentials not configured. Please configure the Email skill.";
      try {
        return await gmailReadEmails(gmailUser, gmailAppPassword, count);
      } catch (e) {
        return `Gmail read error: ${e.message}`;
      }
    }

    case "send_email": {
      const to = args.to || args.recipient || "";
      if (!to) return "Error: send_email requires a 'to' argument.";
      return "__EMAIL_PENDING__";
    }

    default:
      return `Error: Unknown tool "${toolName}" in email skill.`;
  }
}

module.exports = { executeTool, gmailSendEmail };
