import type { IVisualSignatureStrategy } from './IVisualSignatureStrategy.js';
import { DigitalSignatureVisualStrategy } from './DigitalSignatureVisualStrategy.js';
import { SignatureType } from './types.js';

export class SignatureVisualFactory {
  static getStrategy(type?: SignatureType): IVisualSignatureStrategy {
    switch (type) {
      case SignatureType.AADHAAR:
        // Fallback to digital for now until Aadhaar is explicitly implemented
        return new DigitalSignatureVisualStrategy();
      case SignatureType.DIGITAL:
      default:
        return new DigitalSignatureVisualStrategy();
    }
  }
}
