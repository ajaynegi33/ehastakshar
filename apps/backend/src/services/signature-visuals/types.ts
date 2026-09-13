export enum SignatureType {
  DIGITAL = 'DIGITAL',
  AADHAAR = 'AADHAAR'
}

export interface VisualSignatureDetails {
  transactionId: string;
  recipientName: string;
  signatureUrl?: string;
  ipAddress?: string;
  signatureType?: SignatureType;
}
