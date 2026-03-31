"use client";

import React from "react";
import "./scanAnimation.css";

export default function Scan360GuideAnimation() {
  return (
    <div className="scan-container" aria-hidden="true">
      <div className="circle" />
      <div className="foot" />
      <div className="phone-wrapper">
        <div className="phone" />
      </div>
    </div>
  );
}

