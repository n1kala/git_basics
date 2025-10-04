/*
  Hackathon placeholder: iterate subscribers, call advisory and river endpoints, and log notifications.
  In production, wire to email/SMS service.
*/

async function main() {
  const base = process.env.BASE_URL || "http://localhost:3000";
  const subs = await fetch(`${base}/api/subscribe`).then((r) => r.json());
  for (const s of subs.subscribers ?? []) {
    const { email, lat, lng, radiusKm } = s;
    const [adv, riv] = await Promise.all([
      fetch(`${base}/api/advice?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}&years=5`).then((r) => r.json()),
      fetch(`${base}/api/river?lat=${lat}&lng=${lng}`).then((r) => r.json()),
    ]);
    console.log(`Notify ${email}: risk=${Math.round((adv?.risk?.overall ?? 0) * 100)}% level=${adv?.advice?.level}, river=${riv?.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
