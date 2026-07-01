import type { Metadata } from 'next';
import LegalPage, { LegalSection, LegalSub, LegalList } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing your use of the RE/MAX Platinum website and home valuation services.',
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="February 19, 2026">
      <LegalSection heading="Agreement to Terms">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of the RE/MAX Platinum website
          and home valuation services (collectively, the &quot;Services&quot;). By accessing or using our
          Services, you agree to be bound by these Terms. If you do not agree to these Terms, please do not use
          our Services.
        </p>
        <p>
          RE/MAX Platinum (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) reserves the right to modify these
          Terms at any time. Your continued use of the Services after changes are posted constitutes your
          acceptance of the modified Terms.
        </p>
      </LegalSection>

      <LegalSection heading="Use of Services">
        <LegalSub>Eligibility</LegalSub>
        <p>
          You must be at least 18 years old to use our Services. By using our Services, you represent and
          warrant that you meet this age requirement and have the legal capacity to enter into these Terms.
        </p>
        <LegalSub>Permitted Use</LegalSub>
        <p>
          You may use our Services for lawful purposes only. Specifically, you agree to use our home valuation
          tool and other Services to:
        </p>
        <LegalList
          items={[
            'Obtain property valuations for properties you own or have a legitimate interest in',
            'Request information about real estate services',
            'Download educational resources about selling real estate',
            'Contact our agents for professional real estate assistance',
          ]}
        />
        <LegalSub>Prohibited Activities</LegalSub>
        <p>You agree not to:</p>
        <LegalList
          items={[
            'Use the Services for any illegal or unauthorized purpose',
            'Submit false, misleading, or fraudulent information',
            'Attempt to gain unauthorized access to our systems or networks',
            'Use automated tools (bots, scrapers) to access or collect data from our Services',
            'Interfere with or disrupt the operation of our Services',
            'Violate any applicable laws or regulations',
            'Infringe upon the intellectual property rights of RE/MAX Platinum or third parties',
            'Use our Services to harass, abuse, or harm others',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Home Valuation Tool">
        <LegalSub>Estimates Only</LegalSub>
        <p>
          Our home valuation tool provides <strong>estimates only</strong> and should not be considered as
          professional appraisals, official property valuations, or guarantees of actual market value.
          Valuations are generated using third-party data and algorithms and may not reflect current market
          conditions, property condition, or unique features.
        </p>
        <LegalSub>No Guarantee of Accuracy</LegalSub>
        <p>
          While we strive to provide accurate estimates, we make no representations or warranties regarding the
          accuracy, completeness, or reliability of valuation data. Actual property values may differ
          significantly from estimates provided by our tool. For an accurate assessment of your property&apos;s
          value, we recommend consulting with a licensed real estate professional or certified appraiser.
        </p>
        <LegalSub>Not Financial or Legal Advice</LegalSub>
        <p>
          The information provided through our Services, including property valuations and market data, does not
          constitute financial, legal, or tax advice. You should consult with appropriate professionals before
          making any real estate or financial decisions.
        </p>
      </LegalSection>

      <LegalSection heading="Intellectual Property">
        <p>
          All content on our website, including text, graphics, logos, images, software, and design elements, is
          the property of RE/MAX Platinum or its licensors and is protected by copyright, trademark, and other
          intellectual property laws.
        </p>
        <p>
          The RE/MAX name, logo, and related marks are trademarks of RE/MAX, LLC. You may not use these marks
          without prior written permission from RE/MAX, LLC.
        </p>
        <p>
          You may view, download, and print content from our website for personal, non-commercial use only. You
          may not reproduce, distribute, modify, or create derivative works from our content without express
          written permission.
        </p>
      </LegalSection>

      <LegalSection heading="Third-Party Services and Links">
        <p>Our Services integrate with and link to third-party services, including:</p>
        <LegalList
          items={[
            'RentCast (property valuation data)',
            'Google Maps (address autocomplete and location services)',
            'Customer relationship management providers',
            'External websites and resources',
          ]}
        />
        <p>
          We are not responsible for the content, privacy practices, or terms of service of these third-party
          providers. Your use of third-party services is subject to their respective terms and policies.
        </p>
      </LegalSection>

      <LegalSection heading="No Real Estate Agency Relationship Created">
        <p>
          Use of our Services does not create a broker-client or agency relationship. Our Services do not create
          a broker-client relationship until you enter into a formal listing agreement or buyer representation
          agreement with one of our agents.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimer of Warranties">
        <p>
          OUR SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY
          KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
        </p>
        <LegalList
          items={[
            'Our Services will be uninterrupted, timely, secure, or error-free',
            'The results obtained from using our Services will be accurate or reliable',
            'Any errors or defects in our Services will be corrected',
            'Our Services will meet your specific requirements',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Limitation of Liability">
        <p>
          TO THE FULLEST EXTENT PERMITTED BY LAW, RE/MAX PLATINUM, ITS AFFILIATES, OFFICERS, DIRECTORS,
          EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, OR GOODWILL, ARISING OUT OF
          OR RELATED TO YOUR USE OF OUR SERVICES.
        </p>
        <p>
          IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS RELATED TO OUR SERVICES EXCEED THE AMOUNT
          YOU PAID TO US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED DOLLARS ($100), WHICHEVER
          IS GREATER.
        </p>
      </LegalSection>

      <LegalSection heading="Indemnification">
        <p>
          You agree to indemnify, defend, and hold harmless RE/MAX Platinum, its affiliates, and their
          respective officers, directors, employees, and agents from and against any claims, liabilities,
          damages, losses, costs, or expenses (including reasonable attorneys&apos; fees) arising out of or
          related to your use of our Services, your violation of these Terms, your violation of any rights of
          another party, or any information you submit through our Services.
        </p>
      </LegalSection>

      <LegalSection heading="Real Estate Licensing">
        <p>
          RE/MAX Platinum is a licensed real estate brokerage operating in the State of Michigan. All real
          estate services are provided by licensed real estate professionals in accordance with Michigan real
          estate laws and regulations.
        </p>
      </LegalSection>

      <LegalSection heading="Governing Law and Dispute Resolution">
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State of Michigan,
          without regard to its conflict of law principles.
        </p>
        <p>
          Any disputes arising out of or related to these Terms or our Services shall be resolved through binding
          arbitration in accordance with the rules of the American Arbitration Association, conducted in
          Livingston County, Michigan. You waive any right to participate in a class action lawsuit or class-wide
          arbitration.
        </p>
      </LegalSection>

      <LegalSection heading="Contact Us">
        <p>If you have questions about these Terms of Service, please contact us:</p>
        <div className="rounded-card border border-line bg-cream p-5">
          <p className="font-semibold text-charcoal">RE/MAX Platinum</p>
          <p className="text-mute">6870 Grand River Ave</p>
          <p className="text-mute">Brighton, MI 48114</p>
          <p className="mt-2 text-mute">
            <strong>Phone:</strong>{' '}
            <a href="tel:810-227-4600" className="text-platinum-blue hover:underline">
              810-227-4600
            </a>
          </p>
        </div>
      </LegalSection>
    </LegalPage>
  );
}
