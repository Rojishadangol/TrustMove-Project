# TrustMove-Project

## Customer email notifications

The browser submits quotes and messages to Supabase. The backend then verifies each private request reference against Supabase and sends a confirmation with the quote or message number. When an admin records a shipment, the backend verifies the admin session and emails the customer the tracking number and shipment details.

1. Run the updated `supabase-setup.sql` in the Supabase SQL Editor to add request reference codes and the shipment customer email field.
2. In `backend`, copy `.env.example` to `.env` and set the Supabase project URL, a **server-only** Supabase service-role key, a Resend API key, a verified sender address, and the deployed website origin. Never place these secrets in `script.js` or `admin-dashboard.html`.
3. Start the mail API with `npm start` from `backend` and deploy it at an HTTPS URL reachable by the website.
4. Set `window.TRUSTMOVE_API_URL` to that API's HTTPS base URL before `script.js` and the admin dashboard JavaScript run. The local default is `http://localhost:5000`.

Emails require a verified sender domain at Resend and a running, publicly reachable backend. The website still records requests and shipments in Supabase when email delivery is unavailable, and shows a notice when sending fails.
