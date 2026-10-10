export function GET() {
  return Response.json({ agent_id: process.env.ELEVENLABS_AGENT_ID ?? "" });
}
