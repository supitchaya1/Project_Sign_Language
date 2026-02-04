export async function translateToPose(tokens: string[]) {
  const res = await fetch(
    "https://YOUR_PROJECT_ID.supabase.co/functions/v1/translate-to-pose",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens }),
    }
  );

  return res.json();
}
