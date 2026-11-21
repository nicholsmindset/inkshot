import { useState } from 'react';
import { ArrowRight, Check, Globe, Pencil, Download } from 'lucide-react';

const steps = [
  { title: 'Your website', action: 'You bring the business.', description: 'Enter your website and the offer you want to promote. Add your own product photo for a more recognisable starting point.' },
  { title: 'Your brand brief', action: 'You check the details.', description: 'Review the audience, offer, voice and brand details. Correct anything that does not sound like your business.' },
  { title: 'Your ad ideas', action: 'You choose the direction.', description: 'Choose your angles and edit the prompts. See the credit cost before approving generation.' },
  { title: 'Your campaign', action: 'You have the final say.', description: 'Review the creatives, refine the copy and download your files. Publish through your own social or advertising accounts.' },
];

export function WorkflowDemo() {
  const [step, setStep] = useState(0);
  return <section className="home-workflow" id="workflow" aria-labelledby="workflow-heading">
    <div className="home-section-heading"><div><span className="home-eyebrow">TAKE A LOOK BEFORE YOU SIGN UP</span><h2 id="workflow-heading">Your website goes in.<br /><em>Your campaign takes shape.</em></h2></div><p>Follow June Bakery’s fictional campaign. Click each step to see what happens—and where you’re in control.</p></div>
    <div className="workflow-demo">
      <div className="workflow-selector" role="group" aria-label="Explore the campaign workflow">
        {steps.map((item, index) => <button key={item.title} type="button" aria-pressed={step === index} aria-controls="workflow-preview" onClick={() => setStep(index)}><span>0{index + 1}</span><strong>{item.title}</strong><ArrowRight size={16} aria-hidden="true" /></button>)}
      </div>
      <div className="workflow-body" id="workflow-preview">
        <div className="workflow-explanation" aria-live="polite"><span className="home-eyebrow">STEP {step + 1} OF 4</span><h3>{steps[step].action}</h3><p>{steps[step].description}</p><div className="workflow-control"><Check size={16} aria-hidden="true" /><span>{['No website login needed.', 'Edit the brief before moving on.', 'Approve the cost before generation.', 'Review each creative before export.'][step]}</span></div></div>
        <div className="workflow-screen" aria-label={`${steps[step].title} sample`}>
          <header><span>inkshot / June Bakery</span><span>Illustrative sample</span></header>
          {step === 0 && <div className="workflow-inputs"><Globe size={24} aria-hidden="true" /><h4>What are we promoting?</h4><span className="workflow-field-label">Your business website</span><div className="workflow-static-field">junebakery.example</div><span className="workflow-field-label">Your offer</span><div className="workflow-static-field">Weekend shortcakes. Pre-order by Friday.</div><div className="workflow-product"><img src="/examples/strawberry-cake.webp" width="56" height="56" alt="Strawberry shortcake product photo" /><span>Your product photo<br /><small>Keep the real product at the centre.</small></span></div></div>}
          {step === 1 && <div className="workflow-brief"><div><span className="home-eyebrow">DRAFT BRAND BRIEF</span><h4>June Bakery</h4><Pencil size={17} aria-hidden="true" /></div><dl><div><dt>We sell</dt><dd>Fresh strawberry shortcakes, made for the weekend.</dd></div><div><dt>For</dt><dd>Local customers planning celebrations and gatherings.</dd></div><div><dt>We sound</dt><dd>Warm, simple and celebratory.</dd></div><div><dt>The offer</dt><dd>Pre-order your shortcake by Friday.</dd></div></dl><p className="workflow-footnote">Your real brief is editable. These details are a sample.</p></div>}
          {step === 2 && <div className="workflow-ideas"><h4>Find your campaign angle.</h4>{['Make the weekend a little sweeter.', 'A cake for the people you love.', 'Fresh berries. A Friday deadline.'].map((idea,i)=><div className="workflow-angle" key={idea}><span>0{i+1}</span><strong>{idea}</strong><Pencil size={14} aria-hidden="true" /></div>)}<div className="workflow-cost"><span>Sample complete kit<br /><small>3 videos · 3 images · 3 posts</small></span><strong>100 credits</strong></div><p className="workflow-footnote">Review and edit prompts before approving.</p></div>}
          {step === 3 && <div className="workflow-results"><h4>One offer. A consistent campaign.</h4><div className="workflow-result-grid">{[['bakery-image.jpg','Image ad'],['bakery-poster.webp','Video poster'],['bakery-post.jpg','Social post']].map(([file,label])=><figure key={file}><img src={'/examples/'+file} alt={`June Bakery ${label.toLowerCase()} sample`} width="108" height="135" loading="lazy" /><figcaption>{label}</figcaption></figure>)}</div><p className="workflow-footnote">Three sample previews shown. The complete kit contains nine assets.</p><a href="#examples" className="brief-start"><Download size={16} /> Try the sample downloads</a></div>}
        </div>
      </div>
      <footer className="workflow-footer"><span>This walkthrough doesn’t generate ads or use credits.</span>{step < 3 ? <button className="button" type="button" onClick={() => setStep(step + 1)}>Next: {steps[step + 1].title.toLowerCase()} <ArrowRight size={16} /></button> : <a className="button" href="#hero-website">Start my own brief <ArrowRight size={16} /></a>}</footer>
    </div>
  </section>;
}
