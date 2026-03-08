import type { ReactNode } from 'react';

type ImageCreditLineProps = {
  credit?: string;
  license?: string;
  licenseUrl?: string;
  singleUse?: boolean;
};

export function ImageCreditLine({ credit, license, licenseUrl, singleUse }: ImageCreditLineProps) {
  const parts: ReactNode[] = [];
  if (credit) parts.push(`Photo credit: ${credit}`);
  if (license) {
    parts.push(
      licenseUrl ? (
        <a key={licenseUrl} href={licenseUrl} target="_blank" rel="noreferrer" className="hover:text-text2 hover:underline">
          License: {license}
        </a>
      ) : (
        `License: ${license}`
      )
    );
  }
  if (singleUse) parts.push('Single-use');
  if (!parts.length) return null;
  return (
    <div className="mt-1 text-[10px] leading-snug text-text3">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && <span className="px-1 text-text3/70">•</span>}
          {part}
        </span>
      ))}
    </div>
  );
}
