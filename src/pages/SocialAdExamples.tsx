import { Facebook, Instagram, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, ThumbsUp, Share2, Music2, ArrowUpRight } from 'lucide-react';

function TikTokMark() {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M16.7 2c.3 2.6 1.7 4.1 4.3 4.3v3.4a9 9 0 0 1-4.3-1.3v7a6.7 6.7 0 1 1-5.8-6.6v3.5a3.3 3.3 0 1 0 2.3 3.1V2z" /></svg>;
}
function Profile({ instagram = false }: { instagram?: boolean }) {
  return <div className="social-profile"><img src="/examples/strawberry-cake.webp" width="36" height="36" alt="" /><div><strong>{instagram ? 'junebakery' : 'June Bakery'}</strong><span>{instagram ? 'Sponsored' : 'Sponsored · Public'}</span></div><MoreHorizontal size={20} aria-hidden="true" /></div>;
}

export function SocialAdExamples() {
  return <>
    <p className="social-gallery-note">See the creative in context. Illustrative placements for a fictional bakery—not live posts or platform integrations.</p>
    <div className="home-output-grid social-gallery">
      <figure>
        <div className="social-stage"><div className="platform-label"><Facebook size={20} aria-hidden="true" /><strong>Facebook feed</strong><span>Mockup</span></div>
          <div className="social-post facebook-post" aria-label="Facebook feed ad mockup for June Bakery">
            <Profile />
            <p className="social-caption">Weekend plans? Bring the cake. 🍓<br />Our strawberry shortcakes are ready for your next little celebration.</p>
            <img className="social-creative" src="/examples/bakery-image.jpg" width="1080" height="1350" loading="lazy" alt="Strawberries for the weekend: June Bakery portrait cake ad" />
            <div className="facebook-cta"><div><span>JUNE BAKERY</span><strong>Pre-order by Friday</strong></div><span className="mock-cta">Shop now</span></div>
            <div className="facebook-actions" aria-hidden="true"><span><ThumbsUp size={16} /> Like</span><span><MessageCircle size={16} /> Comment</span><span><Share2 size={16} /> Share</span></div>
          </div>
        </div>
        <figcaption><span>01 / IMAGE ADS</span><h3>Put your offer in the feed.</h3><p>A clear headline, your product and a reason to take the next step.</p></figcaption>
      </figure>
      <figure>
        <div className="social-stage tiktok-stage"><div className="platform-label"><TikTokMark /><strong>TikTok placement</strong><span>Mockup</span></div>
          <div className="tiktok-phone" aria-label="TikTok-style vertical placement mockup for June Bakery">
            <div className="tiktok-top"><span>Following</span><strong>For You</strong></div>
            <img className="tiktok-creative" src="/examples/bakery-poster.webp" width="1080" height="1920" loading="lazy" alt="Vertical cake creative with the headline Weekend cake orders are open" />
            <div className="tiktok-rail" aria-hidden="true"><img src="/examples/strawberry-cake.webp" width="34" height="34" alt="" /><Heart size={25} /><MessageCircle size={25} /><Bookmark size={24} /><Share2 size={24} /></div>
            <div className="tiktok-copy"><strong>@junebakery</strong><p>A little sweetness for your weekend. 🍓 Pre-order by Friday.</p><span><Music2 size={13} aria-hidden="true" /> Video placement preview</span></div>
            <div className="tiktok-bottom">June Bakery <span>Pre-order shortcakes →</span></div>
          </div>
          <a className="social-sample-link" href="#examples">Explore the video sample <ArrowUpRight size={15} /></a>
        </div>
        <figcaption><span>02 / VERTICAL VIDEO</span><h3>Picture it in the scroll.</h3><p>A vertical placement preview. The downloadable demo is a five-second still video.</p></figcaption>
      </figure>
      <figure>
        <div className="social-stage instagram-stage"><div className="platform-label"><Instagram size={20} aria-hidden="true" /><strong>Instagram feed</strong><span>Mockup</span></div>
          <div className="social-post instagram-post" aria-label="Instagram feed post mockup for June Bakery">
            <Profile instagram />
            <img className="social-creative" src="/examples/bakery-post.jpg" width="1080" height="1080" loading="lazy" alt="Inside our strawberry shortcake: square June Bakery social creative" />
            <div className="instagram-actions" aria-hidden="true"><Heart size={23} /><MessageCircle size={23} /><Send size={23} /><Bookmark size={23} /></div>
            <p className="social-caption"><strong>junebakery</strong> Fresh cream. Sweet strawberries. Soft vanilla sponge. The best part of your weekend is waiting. 🍓</p>
            <p className="social-hashtags">#WeekendTreats #StrawberryShortcake</p>
            <div className="instagram-note">Sample caption · Ready to make your own</div>
          </div>
        </div>
        <figcaption><span>03 / SOCIAL POSTS</span><h3>More than a pretty picture.</h3><p>A finished visual and a caption that gives your audience something to respond to.</p></figcaption>
      </figure>
    </div>
  </>;
}
