const form = document.getElementById("registerForm");
const resultSection = document.getElementById("resultSection");
const resultQr = document.getElementById("resultQr");
const resultCode = document.getElementById("resultCode");
const resultLanding = document.getElementById("resultLanding");
const resultItinerary = document.getElementById("resultItinerary");

function setResult({ code, landingUrl, itineraryUrl }) {
  resultCode.textContent = code;
  resultLanding.setAttribute("href", landingUrl);
  resultItinerary.setAttribute("href", itineraryUrl);
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(landingUrl)}`;
  resultQr.setAttribute("src", qrImageUrl);
  resultSection.style.display = "block";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  const payload = {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    eventId: formData.get("eventId"),
  };
  const apiBase = "https://photobooth-demo-worker.feldi-kfb.workers.dev";

  const res = await fetch(`${apiBase}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    alert(`Register failed: ${text}`);
    return;
  }

  const data = await res.json();
  setResult({
    code: data.code,
    landingUrl: data.landingUrl,
    itineraryUrl: data.itineraryUrl,
  });
});
