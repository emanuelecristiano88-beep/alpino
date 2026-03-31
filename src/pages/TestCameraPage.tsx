import { useEffect } from "react";

export default function TestCameraPage() {
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        const v = document.querySelector("video");
        if (!v) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (v as any).srcObject = stream;
      })
      .catch((e) => {
        console.error(e);
        alert("Errore camera");
      });
  }, []);

  return (
    <video
      autoPlay
      playsInline
      muted
      style={{
        width: "100vw",
        height: "100vh",
        background: "red",
      }}
    />
  );
}

