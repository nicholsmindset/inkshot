import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePlan } from "../plan";
import { BrandMark } from "../ui";
import "./trust.css";

// Plain-language answers to the questions pilot merchants ask in the first week.
export function Help() {
  const plan = usePlan();
  const [support, setSupport] = useState<string | null>(null);
  useEffect(() => { void api<{ supportEmail?: string | null }>("/health").then(h => setSupport(h.supportEmail ?? null)).catch(() => {}); }, []);
  const cap = plan?.videoRegenMonthlyCap;
  const items: [string, React.ReactNode][] = [
    ["How do credits work?", <>A complete nine-asset kit (3 videos, 3 images, 3 posts) uses {plan?.kitCredits ?? "…"} credits, shown before you approve. Your monthly payment tops your balance up to {plan?.credits ?? "…"} credits. Unused credits do not roll over. Text and caption edits are free.</>],
    ["What is the video regeneration limit?", <>Each workspace can regenerate up to {cap ?? "…"} videos a month. Usage &amp; billing shows how many are left and when the count resets (at your renewal). Images, posts and text edits are not limited this way.</>],
    ["What if an asset fails?", <>Credits for an asset that could not be finished are returned to your balance automatically, and a failed regeneration does not use your monthly video allowance. Your other assets stay available.</>],
    ["Refunds", <>Returned credits are not cash. Subscription refunds are described in our <Link to="/terms">terms</Link>. {support ? <>To ask for one, email <a href={`mailto:${support}`}>{support}</a>.</> : <>Contact details are in the terms.</>}</>],
    ["Can I say my food is halal?", <>Only if you are certified. Halal or MUIS wording can appear in your ads only after you confirm your MUIS certification in your brand brief and upload the certificate image. Inkshot never draws certification logos or badges; if your ad needs one, add it yourself in your own design tool. You are responsible for checking every claim, price and offer before you publish.</>],
    ["How do I post to Instagram and Facebook?", <>Download your assets, then open Meta Business Suite (business.facebook.com) or the Instagram app. Upload the video or image, paste the caption saved in your download, and add your destination link. Check the preview, then publish or schedule. Inkshot does not post for you or run your ad spending.</>],
    ["How do I delete my data?", <>Open Settings. Where account deletion is available, it removes your campaigns, files and sign-in after any active subscription is cancelled. {support ? <>If you cannot see it, email <a href={`mailto:${support}`}>{support}</a>.</> : null} See the <Link to="/privacy">privacy notice</Link> for what can remain in backups and provider records.</>],
    ["My website would not read", <>Some sites block automated reading. Type your business details into the brief, or paste your About text or menu items into “Facts we can use”. You can still make a full campaign.</>],
  ];
  return (
    <main className="trust-page">
      <Link to="/" aria-label="Inkshot home"><BrandMark /></Link>
      <p className="eyebrow">INKSHOT / HELP</p>
      <h1>Help and answers.</h1>
      {items.map(([question, answer]) => <section key={question}><h2>{question}</h2><p>{answer}</p></section>)}
      <section><h2>Still stuck?</h2><p>{support ? <>Email <a href={`mailto:${support}`}>{support}</a>. If something showed a reference number, include it.</> : <>Support contact details are being set up for the pilot. If something showed a reference number, keep it handy.</>}</p></section>
      <p><Link to="/studio">Back to your studio</Link></p>
    </main>
  );
}
