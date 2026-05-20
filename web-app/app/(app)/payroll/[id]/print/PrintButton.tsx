"use client";

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="print-button">
      Save as PDF / Print
    </button>
  );
}
