"use client";
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ShieldCheck, Download, CheckCircle, FileText, ChevronRight, MapPin, Camera } from 'lucide-react';
import { toast } from "sonner";
import dynamic from "next/dynamic";
import Webcam from "react-webcam";
import imageCompression from "browser-image-compression";
import SignatureModal from "./SignatureModal";
import ConsentModal from "./ConsentModal";

const PDFViewer = dynamic(() => import("@/app/(authenticated)/esign/send/digital/PDFViewer"), { ssr: false });

interface DocumentInfo {
  documentTitle: string;
  transactionId: string;
  recipientName: string;
  recipientEmail: string;
  status: "PENDING" | "SIGNED";
  requireGps: boolean;
  requirePhoto: boolean;
}

export default function SignerPortalPage() {
  const params = useParams();
  const token = params.secure_token as string;

  const [docInfo, setDocInfo] = useState<DocumentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [step, setStep] = useState<"VIEW" | "OTP" | "GATHER" | "CONSENT" | "SIGN" | "SUCCESS">("VIEW");
  const [otp, setOtp] = useState("");
  const [signToken, setSignToken] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [countdown, setCountdown] = useState(0);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  const [consentTimestamp, setConsentTimestamp] = useState<string>("");

  // Requirements Gathering States
  const [locationDenied, setLocationDenied] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const webcamRef = useRef<Webcam>(null);

  useEffect(() => {
    const fetchDoc = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/document/${token}`);
        if (!res.ok) {
          setError("Document not found or token invalid");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setDocInfo(data);

        // Check for existing sign session to survive browser permission refreshes
        const existingSignToken = sessionStorage.getItem(`ehastakshar_signToken_${token}`);
        if (existingSignToken && data.status !== "SIGNED" && data.status !== "COMPLETED") {
          setSignToken(existingSignToken);
          setSignatureText(data.recipientName || "");
          if (data.requireGps || data.requirePhoto) {
            setStep("GATHER");
          } else {
            setStep("CONSENT");
          }
        }

        // Fetch PDF blob
        const pdfRes = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/document/${token}/download`);
        if (pdfRes.ok) {
          const blob = await pdfRes.blob();
          setPdfFile(blob);
        }
      } catch {
        setError("Failed to fetch document");
      } finally {
        setLoading(false);
      }
    };
    fetchDoc();
  }, [token]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === "OTP" && countdown > 0) {
      timer = setInterval(() => setCountdown(c => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Handle GPS
  useEffect(() => {
    if (step === "GATHER" && docInfo?.requireGps && !latitude) {
      if (!navigator.geolocation) {
        setLocationDenied(true);
        logClientEvent("DENIED_LOCATION");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude);
          setLongitude(position.coords.longitude);
        },
        (error) => {
          setLocationDenied(true);
          logClientEvent("DENIED_LOCATION");
        }
      );
    }
  }, [step, docInfo?.requireGps, latitude]);

  const logClientEvent = async (action: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/document/${token}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
    } catch (e) {
      // Ignore errors for logging
    }
  };

  const requestOtp = async () => {
    if (isSendingOtp) return;
    setIsSendingOtp(true);
    setStep("OTP");

    toast.promise(
      fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to send OTP");
        }
        return res.json();
      }),
      {
        loading: "Sending OTP securely...",
        success: () => {
          setCountdown(60);
          setIsSendingOtp(false);
          return "OTP sent successfully!";
        },
        error: (err: any) => {
          setIsSendingOtp(false);
          setStep("VIEW"); // Return to view if failed
          return err.message || "Failed to send OTP";
        }
      }
    );
  };

  const verifyOtp = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, otp })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid OTP");

      setSignToken(data.signToken);
      sessionStorage.setItem(`ehastakshar_signToken_${token}`, data.signToken);
      setSignatureText(docInfo?.recipientName || "");

      if (docInfo?.requireGps || docInfo?.requirePhoto) {
        setStep("GATHER");
      } else {
        setStep("CONSENT");
      }
      toast.success("Identity verified successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsVerifying(false);
    }
  };

  const capturePhotoAndProceed = useCallback(async () => {
    if (docInfo?.requirePhoto) {
      if (webcamRef.current) {
        const imageSrc = webcamRef.current.getScreenshot();
        if (imageSrc) {
          try {
            // Convert base64 to Blob
            const fetchRes = await fetch(imageSrc);
            const blob = await fetchRes.blob();
            const file = new File([blob], "photo.jpg", { type: "image/jpeg" });

            // Compress Image
            const options = {
              maxSizeMB: 0.5,
              maxWidthOrHeight: 800,
              useWebWorker: true
            };
            const compressedBlob = await imageCompression(file, options);
            setPhotoBlob(compressedBlob);
          } catch (error) {
            toast.error("Failed to capture photo");
            return;
          }
        }
      }
    }
    setStep("CONSENT");
  }, [docInfo?.requirePhoto, webcamRef]);

  const submitSignature = async (sigText: string, sigBlob: Blob) => {
    setIsSigning(true);
    try {
      const formData = new FormData();
      formData.append("token", token);
      formData.append("signToken", signToken);
      formData.append("signatureText", sigText);
      formData.append("signatureFile", sigBlob, "signature.png");
      formData.append("consentGranted", "true");
      formData.append("consentTimestamp", consentTimestamp);

      if (latitude && longitude) {
        formData.append("latitude", latitude.toString());
        formData.append("longitude", longitude.toString());
      }

      if (photoBlob) {
        formData.append("photo", photoBlob, "photo.jpg");
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/sign`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sign document");

      setStep("SUCCESS");
      toast.success("Document signed successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setIsSigning(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/esign/document/${token}/download`);
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docInfo?.documentTitle || 'Signed_Document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success("Download started");
    } catch (err) {
      toast.error("Failed to download PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  const maskEmail = (email: string) => {
    if (!email) return "";
    const [name, domain] = email.split('@');
    if (name.length <= 2) return email;
    return `${name.substring(0, 2)}${'*'.repeat(name.length - 2)}@${domain}`;
  };

  const memoizedPdfFile = useMemo(() => {
    if (!pdfFile || !docInfo) return null;
    return new File([pdfFile], docInfo.documentTitle, { type: "application/pdf" });
  }, [pdfFile, docInfo?.documentTitle]);

  if (!loading && (error || !docInfo)) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-red-500">{error || "Document not found"}</div>;
  }

  if (docInfo?.status === "SIGNED" && step !== "SUCCESS") {
    setStep("SUCCESS");
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-100 font-sans flex flex-col relative">

      {/* Access Denied Overlay */}
      {(locationDenied || cameraDenied) && (
        <div className="fixed inset-0 z-[100] bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <ShieldCheck size={64} className="text-red-500 mb-6" />
          <h2 className="text-3xl font-bold mb-8 text-red-400">Access Denied!</h2>
          <div className="bg-slate-800 p-8 rounded-2xl max-w-md w-full text-left space-y-6 border border-slate-700 shadow-2xl">
            <p className="text-lg font-medium text-slate-200">1. Click the settings icon in your browser's address bar</p>
            <div className="space-y-4 text-slate-300 pl-6">
              <p className="text-lg font-medium">2. Allow:</p>
              {locationDenied && (
                <div className="flex items-center space-x-3 text-red-400 font-semibold pl-4">
                  <MapPin size={24} />
                  <span>Location access</span>
                </div>
              )}
              {cameraDenied && (
                <div className="flex items-center space-x-3 text-red-400 font-semibold pl-4">
                  <Camera size={24} />
                  <span>Camera access</span>
                </div>
              )}
            </div>
            <p className="text-lg font-medium text-slate-200 pt-4 border-t border-slate-700">3. Please refresh this page to continue</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-10 bg-teal-600 hover:bg-teal-500 text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-black/20 transition-all text-lg"
          >
            Refresh Page
          </button>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-md z-10 relative">
        <div className="flex items-center space-x-3">
          <ShieldCheck className="text-teal-400" size={24} />
          <span className="font-semibold tracking-wide">Ehastakshar Sign Secure Portal</span>
        </div>
        <div className="text-xs text-slate-400 flex items-center">
          Transaction ID:
          {loading ? (
            <span className="inline-block w-32 h-4 bg-slate-700/50 rounded ml-2 animate-pulse"></span>
          ) : (
            <span className="font-mono text-slate-300 ml-1">{docInfo?.transactionId}</span>
          )}
        </div>
      </div>

      {/* Main Content - Document Viewer */}
      <div className="flex-1 flex flex-col p-4 md:p-8 items-center overflow-hidden">
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col h-full overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h2 className="font-bold text-slate-800 flex items-center">
              <FileText size={18} className="mr-2 text-slate-400" />
              {loading ? (
                <span className="inline-block w-48 h-5 bg-slate-200 rounded animate-pulse"></span>
              ) : (
                docInfo?.documentTitle
              )}
            </h2>
          </div>

          <div className="flex-1 bg-slate-100 p-0 overflow-hidden flex flex-col relative">
            {/* Scrollable PDF Area */}
            <div className="flex-1 overflow-y-auto w-full bg-slate-200/50 shadow-inner custom-scrollbar relative flex flex-col items-center justify-start p-4 md:p-8 scroll-smooth">

              {step === "SUCCESS" ? (
                <div className="w-full h-full min-h-[60vh] flex flex-col items-center justify-center animate-in fade-in duration-500">
                  <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center border border-slate-200 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-teal-500"></div>
                    <div className="w-20 h-20 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                      <CheckCircle size={40} className="relative z-10" />
                      <div className="absolute inset-0 bg-teal-200 rounded-full animate-ping opacity-20"></div>
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">Document Signed</h3>

                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 my-6 text-left space-y-2">
                      <p className="text-sm text-slate-500">Transaction ID:</p>
                      <p className="text-xs font-mono text-slate-800 break-all">{docInfo?.transactionId}</p>
                      <div className="pt-2 border-t border-slate-200 mt-2">
                        <p className="text-sm text-slate-500">Signer Name:</p>
                        <p className="font-semibold text-slate-900">{docInfo?.recipientName}</p>
                      </div>
                    </div>

                    <button
                      onClick={handleDownload}
                      disabled={isDownloading}
                      className="w-full cursor-pointer bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold transition-all shadow-sm flex items-center justify-center space-x-2"
                    >
                      <Download size={18} />
                      <span>{isDownloading ? "Downloading..." : "Download Signed PDF"}</span>
                    </button>
                  </div>
                </div>
              ) : !pdfFile ? (
                <div className="w-full max-w-3xl min-h-[800px] bg-white shadow-xl rounded-xl mx-auto my-4 p-12 flex flex-col border border-slate-200 animate-in fade-in duration-1000">
                  <div className="animate-pulse space-y-8 mt-12">
                    <div className="h-6 bg-slate-100 rounded-md w-3/4 mb-4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full mb-4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full mb-4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-5/6 mb-4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full mb-4 mt-12"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-2/3 mb-4"></div>
                    <div className="h-32 bg-slate-100 rounded-md w-full mt-20"></div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-3xl relative z-0 animate-in slide-in-from-bottom-8 fade-in duration-700 ease-out flex justify-center pb-32">
                  <PDFViewer
                    file={memoizedPdfFile as File}
                    numPages={numPages}
                    onDocumentLoadSuccess={({ numPages }: { numPages: number }) => setNumPages(numPages)}
                  />
                </div>
              )}
            </div>

            {/* Proceed to Sign Floating Button */}
            {step === "VIEW" && (
              <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8 z-50 animate-in slide-in-from-bottom-8 fade-in duration-700 ease-out">
                <div className="relative group">
                  <button
                    onClick={requestOtp}
                    disabled={isSendingOtp}
                    className="relative cursor-pointer bg-teal-600 hover:bg-teal-700 text-white px-6 md:px-8 py-3 md:py-4 rounded-full font-bold shadow-lg shadow-black/10 flex items-center space-x-3 transition-colors duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <span className="relative z-10 tracking-wide text-xs md:text-sm uppercase">Proceed to Sign</span>
                    <ChevronRight size={20} className="relative z-10 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals Container */}
      {(step === "OTP" || step === "GATHER" || step === "CONSENT" || step === "SIGN") && !(locationDenied || cameraDenied) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">

          {/* OTP Modal */}
          {step === "OTP" && (
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 md:p-8 animate-in zoom-in-95 duration-300 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-teal-500"></div>

              <h3 className="text-2xl font-bold text-slate-900 mb-1">eSign Authentication</h3>
              <p className="text-xs text-slate-500 font-mono mb-6">Transaction ID: {docInfo?.transactionId}</p>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-6">
                <p className="text-sm text-slate-700">
                  OTP has been sent to <strong className="text-slate-900">{maskEmail(docInfo?.recipientEmail || "")}</strong>
                </p>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Enter OTP</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
                    disabled={isSendingOtp}
                    className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-mono text-xl tracking-[0.5em] text-center disabled:bg-slate-50 disabled:text-slate-400"
                    placeholder="••••••"
                  />
                </div>

                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Did not receive OTP?</span>
                  {countdown > 0 ? (
                    <span className="text-slate-400 font-medium">Resend in 00:{countdown.toString().padStart(2, '0')}</span>
                  ) : isSendingOtp ? (
                    <span className="text-teal-400 font-medium animate-pulse">Sending...</span>
                  ) : (
                    <button onClick={requestOtp} className="text-teal-600 font-semibold hover:underline cursor-pointer">Resend Now</button>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 p-4 -mx-8 -mb-8 mt-8 border-t border-slate-100 flex flex-col space-y-4">
                <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                  By proceeding, I agree to the <a href="#" className="text-teal-600 hover:underline">Terms and Conditions</a> and <a href="#" className="text-teal-600 hover:underline">Privacy Policy</a>
                </p>
                <button
                  onClick={verifyOtp}
                  disabled={otp.length !== 6 || isVerifying || isSendingOtp}
                  className="w-full cursor-pointer bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-bold transition-all shadow-sm flex justify-center items-center"
                >
                  {isVerifying ? "Verifying..." : "Verify"}
                </button>
              </div>
            </div>
          )}

          {/* Gather GPS & Photo Modal */}
          {step === "GATHER" && (
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 md:p-8 animate-in zoom-in-95 duration-300 text-center">
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Security Check</h3>

              <div className="space-y-6">
                {docInfo?.requireGps && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <MapPin className="text-teal-500" />
                      <span className="font-semibold text-slate-700">GPS Location</span>
                    </div>
                    {latitude ? (
                      <CheckCircle className="text-green-500" />
                    ) : (
                      <span className="text-xs font-bold text-slate-400 animate-pulse">Locating...</span>
                    )}
                  </div>
                )}

                {docInfo?.requirePhoto && (
                  <div className="flex flex-col items-center">
                    <div className="w-full bg-slate-900 rounded-xl overflow-hidden aspect-video relative flex items-center justify-center">
                      {/* @ts-ignore - React 19 type mismatch with react-webcam */}
                      <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: "user" }}
                        className="w-full h-full object-cover"
                        onUserMediaError={() => {
                          setCameraDenied(true);
                          logClientEvent("DENIED_CAMERA");
                        }}
                      />
                      <div className="absolute inset-0 pointer-events-none border-4 border-teal-500/30 rounded-xl"></div>
                    </div>
                    <p className="text-xs text-slate-500 mt-3 flex items-center justify-center">
                      <Camera size={14} className="mr-1" /> Look at the camera for identity verification
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-8">
                <button
                  onClick={capturePhotoAndProceed}
                  disabled={docInfo?.requireGps && !latitude}
                  className="w-full cursor-pointer bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-bold transition-all shadow-sm flex justify-center items-center"
                >
                  Proceed
                </button>
              </div>
            </div>
          )}

          {/* Consent Modal */}
          {step === "CONSENT" && (
            <ConsentModal
              recipientEmail={docInfo?.recipientEmail || ""}
              onProceed={(timestamp) => {
                setConsentTimestamp(timestamp);
                setStep("SIGN");
              }}
            />
          )}

          {/* Sign Modal */}
          {step === "SIGN" && (
            <SignatureModal 
              onCancel={() => setStep("VIEW")}
              onConfirm={submitSignature}
              isSigning={isSigning}
              initialName={docInfo?.recipientName}
            />
          )}
        </div>
      )}
    </div>
  );
}
