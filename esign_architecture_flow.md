# Ehastakshar End-to-End eSign Architecture & Security Flow

This document maps out the complete lifecycle of a digital signature transaction within the Ehastakshar platform. It details the exact interplay between the Frontend (React), Backend (Express), and the Cryptographic Engine, highlighting every security check and validation step.

---

## 1. Document Initialization (The Sender Flow)

The process begins when an authenticated user uploads a PDF and specifies the recipients who need to sign it.

### Frontend Action
- The sender fills out the "Send Document" form, uploading a PDF and entering recipient details (Name, Email, Phone).
- **API Call:** `POST /api/esign/send` (Requires JWT Authorization Bearer token).

### Backend Execution & Security
1. **Authentication Check:** The `AuthMiddleware` verifies the sender's JWT to ensure they are logged in.
2. **Storage Upload:** The backend uploads the raw PDF to the storage provider (e.g., S3 or local storage) and retrieves a secure `fileUrl`.
3. **Database Transaction:**
   - A new `Document` record is created.
   - For each recipient, a `DocumentRecipient` record is created.
   - **Security Check (Tokenization):** The system generates a cryptographically secure, unpredictable UUID (`secureToken`) for each recipient. This token is used in the URL sent to the recipient, ensuring document URLs cannot be guessed or enumerated.
4. **Audit Logging:** An `UPLOADED` event is logged in the `AuditLogRepository`.
5. **Dispatch:** The system uses Resend (`AuthService.sendInviteEmail`) to email the unique signing link to each recipient.

---

## 2. Recipient Authentication & OTP Request

The recipient receives the email and clicks the link, bringing them to the verification portal.

### Frontend Action
- The recipient lands on `/sign/[secure_token]`.
- The UI extracts the token from the URL and prompts the user to request an OTP to prove their identity.
- **API Call:** `POST /api/esign/request-otp` (Payload: `{ token }`).

### Backend Execution & Security
1. **Token Validation:** The backend queries `DocumentRecipientRepository.findBySecureToken(token)`. If invalid, the request is rejected.
2. **Status Check:** Ensures the recipient's status is not already `SIGNED`.
3. **OTP Generation (Security Check):** 
   - `AuthService.generateOtp()` uses `crypto.randomBytes` to generate a 6-character alphanumeric code that is highly resistant to prediction.
4. **OTP Hashing (Security Check):**
   - The plaintext OTP is **NEVER** stored in the database.
   - It is hashed using **Argon2** (a memory-hard hashing algorithm resistant to GPU cracking).
   - The hash is stored in the `OtpRepository` with a strict 10-minute expiration timestamp.
5. **Dispatch:** The plaintext OTP is emailed to the recipient.

---

## 3. OTP Verification & Session Binding

The recipient enters the code they received in their email to access the document.

### Frontend Action
- The recipient enters the 6-digit code.
- **API Call:** `POST /api/esign/verify-otp` (Payload: `{ token, otp }`).

### Backend Execution & Security
1. **OTP Verification:**
   - The backend retrieves the Argon2 hash for the recipient's email.
   - Checks the expiration timestamp.
   - Uses `argon2.verify` to check if the provided OTP matches the hash.
2. **Replay Attack Prevention (Security Check):**
   - The OTP hash is immediately deleted from the database (`OtpRepository.deleteByEmail`) upon the first successful verification, ensuring it can never be used again.
3. **Session Hijacking Prevention (Security Check):**
   - The backend captures the incoming IP address (`req.ip`).
   - `AuthService.generateToken(userId, ipAddress)` generates a short-lived (15 minutes) `signToken` JWT.
   - **IP-Binding:** The user's IP address is cryptographically locked inside this JWT.
4. **Response:** The `signToken` is returned to the frontend and stored in state.

---

## 4. The Cryptographic Signing Process

The recipient reviews the document, optionally draws their signature, captures a webcam photo, and finalizes the signature.

### Frontend Action
- The user clicks "Sign Document".
- The frontend compiles a `multipart/form-data` payload containing the drawing image, geolocation (if permitted), the original secure `token`, and the IP-bound `signToken`.
- **API Call:** `POST /api/esign/sign`

### Backend Execution & Security
1. **OTP Bypass Prevention (Critical Security Check):**
   - The backend extracts the `signToken` JWT. If it is missing, the request is rejected.
   - The JWT is verified using the server's `JWT_SECRET`.
   - The `userId` inside the JWT must strictly match the `recipient.id` linked to the document.
2. **IP Session Binding Validation (Security Check):**
   - The backend captures the IP address of the incoming `/sign` request.
   - It compares this IP against the IP address locked inside the `signToken` JWT. If they differ, the request is rejected as a hijacked session.
3. **Visual Preparation:**
   - `DigitalSignatureService.addSignaturePlaceholder` uses `pdf-lib` to visually draw the signature image, the Date (IST), and the Transaction ID onto the last page of the PDF.
   - It allocates an 8192-byte placeholder in the PDF's `/ByteRange` dictionary for the upcoming cryptography.
4. **Cryptographic Sealing (Non-Repudiation Check):**
   - `DigitalSignatureService.sealDocument` uses `@signpdf/signpdf`.
   - It mathematically hashes the entire document (excluding the placeholder).
   - It encrypts the hash using the server's private key (`dev-cert.p12` or production Class 3 Certificate).
   - The resulting PKCS#7 signature is injected into the PDF, rendering it **Tamper-Evident**. Any subsequent alteration to the file will mathematically break the signature in PDF readers.

---

## 5. Finalization & Audit Trail

With the document cryptographically sealed, the system completes the transaction.

### Backend Execution
1. **Storage Update:** The newly sealed PDF overwrites the original file in the storage provider.
2. **Database Finalization:** 
   - A database transaction marks the recipient as `SIGNED`.
   - Geolocation (Latitude/Longitude) is reverse-geocoded to a City/State and stored.
   - The user agent string is parsed to store the Device Type and Browser.
3. **Audit Logging:** A final `SIGNED` event is recorded.
4. **Notification:** The `COMPLETED` email is dispatched to the recipient with a download link.
5. **Audit PDF Generation:** When requested, the `ESignController.downloadAuditReport` endpoint compiles all the secure database logs into a legally robust Audit Trail PDF, appending it to the transaction history.

---

## 6. Document Access Control & Download Flow

Once a document is signed, users must be able to securely download the finalized PDF and its associated Audit Trail.

### Frontend Action
- The recipient clicks the download link in their `COMPLETED` email, or the sender clicks download on their dashboard.
- **API Call (Recipient):** `GET /api/esign/document/:token/download`
- **API Call (Sender):** `GET /api/esign/document/:id/download-audit`

### Backend Execution & Security
1. **Recipient Access Check:** The `/download` endpoint explicitly requires the exact, unguessable `secureToken` that was originally emailed to the recipient. Without this token, the document cannot be accessed.
2. **Sender Access Check:** The `/download-audit` endpoint requires a valid JWT Bearer token. The backend verifies that the `userId` in the JWT matches the `uploaderId` of the document, preventing cross-tenant data leaks.
3. **Streamed Response:** To prevent server memory exhaustion, the PDF is downloaded from the Storage Provider as a stream and piped directly to the HTTP response using `res.pipe()`.

---

## 7. Infrastructure Security & Production Controls

A legally binding platform requires security infrastructure extending beyond just the application code.

### 1. Rate Limiting & Abuse Prevention (Security Check)
- **The Threat:** Malicious actors attempting to brute-force the 6-digit OTP or spamming the `/request-otp` endpoint to exhaust Resend email credits.
- **The Defense:** A strict Rate Limiter (e.g., `express-rate-limit`) must be applied to the `/request-otp` and `/verify-otp` endpoints, limiting users to a maximum of 5 requests per 15 minutes per IP address.

### 2. Cryptographic Key Management (Security Check)
- **The Threat:** If the server's `.p12` Document Signer Certificate or the `JWT_SECRET` is compromised, the entire legal validity of the platform collapses.
- **The Defense:** 
  - The `JWT_SECRET` must be highly entropic (e.g., 64 random hex characters) and injected at runtime via Environment Variables.
  - The `.p12` Certificate password must NEVER be hardcoded in the repository (as it currently is for development). It must be fetched securely from a Key Management Service (like AWS KMS or HashiCorp Vault) at runtime.

### 3. Link Expiration & Revocation
- **The Threat:** A recipient's email account is compromised a year after the transaction, giving the attacker access to the `secureToken` link.
- **The Defense:** The `secureToken` should ideally have a lifespan (e.g., 7 to 30 days). After this period, the URL should expire, and the recipient must request a fresh, OTP-gated access link from the sender.

---

## 8. Core Data Models (Database Schema)

The eSign flow relies on a highly normalized relational database structure to maintain strict auditability.

- **`Documents` Table:** Stores the core transaction (ID, Uploader ID, S3 File URL, Original Title, Status: `PENDING` | `COMPLETED`).
- **`DocumentRecipients` Table:** Links a Document to a Signer (ID, Document ID, Name, Email, Phone, Status: `PENDING` | `SIGNED`, `secureToken`, Signed Timestamp).
- **`OtpRequests` Table:** A volatile table for temporary session state (Email, Argon2 `otpHash`, Expiration Timestamp).
- **`AuditEvents` Table:** An immutable ledger (ID, Document ID, Recipient ID, Action Type, IP Address, User Agent, Timestamp). This table is the sole source of truth for generating the final legal Audit Trail PDF.
