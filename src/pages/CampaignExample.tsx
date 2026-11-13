import { useState } from "react";
import { Download, Film, Image, MessageSquare } from "lucide-react";

const samples = [
  {
    label: "Image ad", icon: Image, file: "bakery-image.jpg",
    headline: "Strawberries for the weekend", detail: "Pre-order by Friday",
    format: "4:5 portrait · JPEG", alt: "June Bakery strawberry cake ad with the headline Strawberries for the weekend and the call to action Pre-order by Friday.",
  },
  {
    label: "Video ad", icon: Film, file: "bakery-video.mp4",
    headline: "Weekend cake orders are open", detail: "Reserve a shortcake",
    format: "9:16 vertical · 5-second still preview", alt: "",
  },
  {
    label: "Social post", icon: MessageSquare, file: "bakery-post.jpg",
    headline: "Inside our strawberry shortcake", detail: "Fresh cream, berries and vanilla sponge",
    format: "1:1 square · JPEG", alt: "Square social post showing the strawberry shortcake with vanilla sponge, strawberries and cream.",
  },
] as const;

export function CampaignExample() {
  const [selected, setSelected] = useState(0);
  const sample = samples[selected];
  const url = "/examples/" + sample.file;
  return (
    <section className="campaign-example" id="examples" aria-label="Explore a fictional bakery campaign">
      <header className="example-heading">
        <span>Sample campaign</span>
        <b>June Bakery</b>
      </header>
      <div className="example-brief">
        <img src="/examples/strawberry-cake.webp" alt="Source photo of a strawberry shortcake" width="64" height="64" />
        <div><b>Campaign brief</b><p>Sell weekend shortcakes. Ask customers to pre-order by Friday.</p></div>
      </div>
      <div className="example-choices" role="group" aria-label="Choose a sample format">
        {samples.map(({ label, icon: Icon }, i) => (
          <button key={label} type="button" aria-pressed={i === selected} onClick={() => setSelected(i)}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div className="example-output">
        <div className="example-media">
          {sample.file.endsWith(".mp4") ? (
            <video controls playsInline preload="none" poster="/examples/bakery-poster.webp" src={url} aria-label="Silent five-second sample showing the strawberry cake and an invitation to reserve a shortcake" />
          ) : (
            <img src={url} alt={sample.alt} />
          )}
        </div>
        <div className="example-copy">
          <div aria-live="polite">
            <p className="example-format">{sample.format}</p>
            <h3>{sample.headline}</h3>
            <p>{sample.detail}</p>
          </div>
          <a href={url} download><Download size={16} aria-hidden="true" /> Download {sample.file.endsWith(".mp4") ? "MP4" : "JPEG"}</a>
        </div>
      </div>
    </section>
  );
}
