
const USER_TIMEZONE = "America/New_York";

function getLocalHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  
  const hour = parts.find(p => p.type === 'hour')?.value;
  console.log("Date:", date.toISOString());
  console.log("Local time:", date.toLocaleString("en-US", { timeZone: USER_TIMEZONE }));
  console.log("FormatToParts hour:", hour);
  
  const directFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(date);
  console.log("Direct format result:", directFormat);
  return Number(directFormat);
}

console.log("Current hour:", getLocalHour());

// Let's test 11:00 UTC (7:00 AM EDT)
const testDate = new Date("2026-03-26T11:00:00Z");
console.log("Testing 11:00Z: result =", getLocalHour(testDate));
