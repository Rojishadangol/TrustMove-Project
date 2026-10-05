const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;

function requireMailConfig(res) {
    if (!supabaseUrl || !serviceKey || !resendKey || !emailFrom) {
        res.status(503).json({ error: "Email notifications are not configured on the server." });
        return false;
    }
    return true;
}

async function supabaseRequest(path, options = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            ...options.headers
        }
    });
    if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
    return response.json();
}

async function sendEmail({ to, subject, text }) {
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: emailFrom, to: [to], subject, text })
    });
    if (!response.ok) throw new Error(`Email provider rejected the message (${response.status}).`);
}

app.post("/api/notifications/request", async (req, res) => {
    if (!requireMailConfig(res)) return;
    const { kind, lookup_code: lookupCode } = req.body || {};
    const table = kind === "quote" ? "quote_requests" : kind === "message" ? "contact_messages" : null;
    if (!table || !/^[0-9a-f-]{36}$/i.test(lookupCode || "")) {
        return res.status(400).json({ error: "A valid request reference is required." });
    }
    try {
        const records = await supabaseRequest(`${table}?lookup_code=eq.${encodeURIComponent(lookupCode)}&select=id,name,email`);
        const record = records[0];
        if (!record) return res.status(404).json({ error: "Request not found." });
        const label = kind === "quote" ? "Quote" : "Message";
        await sendEmail({
            to: record.email,
            subject: `Trust Move ${label} received — #${record.id}`,
            text: `Hello ${record.name},\n\nWe received your ${label.toLowerCase()}. Your ${label.toLowerCase()} number is ${record.id}.\nCurrent status: Received.\n\nKeep your private reference code to check status on the Trust Move website: ${lookupCode}\n\nTrust Move Courier & Cargo`
        });
        res.json({ sent: true, request_number: record.id });
    } catch (error) {
        console.error("Request notification failed:", error.message);
        res.status(502).json({ error: "Could not send the notification email." });
    }
});

app.post("/api/notifications/shipment", async (req, res) => {
    if (!requireMailConfig(res)) return;
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const trackingNumber = String(req.body?.tracking_number || "").trim();
    if (!accessToken || !trackingNumber) return res.status(400).json({ error: "Admin session and tracking number are required." });
    try {
        const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
        });
        if (!userResponse.ok) return res.status(401).json({ error: "Admin session is invalid." });
        const user = await userResponse.json();
        const admins = await supabaseRequest(`admin_users?id=eq.${encodeURIComponent(user.id)}&select=id`);
        if (!admins.length) return res.status(403).json({ error: "Admin access is required." });
        const rows = await supabaseRequest(`shipments?tracking_number=eq.${encodeURIComponent(trackingNumber)}&select=tracking_number,sender_name,sender_email,origin,destination,estimated_delivery,status`);
        const shipment = rows[0];
        if (!shipment) return res.status(404).json({ error: "Shipment not found." });
        if (!shipment.sender_email) return res.status(400).json({ error: "Add a customer email address to this shipment." });
        await sendEmail({
            to: shipment.sender_email,
            subject: `Trust Move shipment recorded — ${shipment.tracking_number}`,
            text: `Hello ${shipment.sender_name},\n\nYour shipment has been recorded by Trust Move Courier & Cargo.\nTracking number: ${shipment.tracking_number}\nStatus: ${shipment.status}\nOrigin: ${shipment.origin}\nDestination: ${shipment.destination}${shipment.estimated_delivery ? `\nEstimated delivery: ${shipment.estimated_delivery}` : ""}\n\nTrack updates on the Trust Move website using your tracking number.\n\nTrust Move Courier & Cargo`
        });
        res.json({ sent: true });
    } catch (error) {
        console.error("Shipment notification failed:", error.message);
        res.status(502).json({ error: "Could not send the shipment email." });
    }
});

app.get("/", (req, res) => {
    res.send("Trust Move API Running 🚚");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
