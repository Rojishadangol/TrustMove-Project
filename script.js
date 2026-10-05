if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('motion-ready');
}

document.addEventListener('DOMContentLoaded', () => {

    setupScrollMotion();

    // =========================================================
    // SUPABASE CONFIGURATION
    // =========================================================

    const SUPABASE_URL = 'https://pvicjdjvobhtzchnzejz.supabase.co';
    // IMPORTANT:
    // Replace the text below with your Supabase PUBLISHABLE/ANON key.
    // NEVER use the service_role/secret key here.
    const SUPABASE_ANON_KEY = 'sb_publishable_abuT9G4-LWi7a-v4KK7EsA_onbBFkw2';
    const NOTIFICATION_API_URL = window.TRUSTMOVE_API_URL || 'http://localhost:5000';

    const supabase = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );

    function setupScrollMotion() {
        const targets = document.querySelectorAll(
            '.section-title, .service-card, .feature-item, .destination-card, .step-card, .about-image, .about-content, .form-container, .contact-info, .contact-form-box'
        );

        if (!('IntersectionObserver' in window)) return;

        const observer = new IntersectionObserver((entries, activeObserver) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    activeObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.14, rootMargin: '0px 0px -24px 0px' });

        targets.forEach((element, index) => {
            element.dataset.reveal = element.classList.contains('about-image') ? 'image' : 'up';
            if (element.matches('.service-card, .feature-item, .destination-card, .step-card')) {
                element.style.transitionDelay = `${(index % 4) * 75}ms`;
            }
            observer.observe(element);
        });
    }
    const hamburger = document.getElementById('hamburger');
    const navbar = document.getElementById('navbar');

    if (hamburger && navbar) {
        hamburger.addEventListener('click', () => {
            const isOpen = navbar.classList.toggle('active');
            hamburger.setAttribute('aria-expanded', String(isOpen));
            hamburger.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
        });
    }

    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            if (navbar) {
                navbar.classList.remove('active');
            }
            if (hamburger) {
                hamburger.setAttribute('aria-expanded', 'false');
                hamburger.setAttribute('aria-label', 'Open navigation menu');
            }
        });
    });

    const quoteDateInput = document.getElementById('quoteDate');
    if (quoteDateInput) {
        const today = new Date();
        const localToday = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0')
        ].join('-');
        quoteDateInput.min = localToday;
    }


    // =========================================================
    // 2. SHIPMENT TRACKING
    // =========================================================

    const trackBtn = document.getElementById('trackBtn');
    const trackingInput = document.getElementById('trackingInput');
    const trackingResult = document.getElementById('trackingResult');

    if (trackBtn && trackingInput && trackingResult) {

        trackBtn.addEventListener('click', handleTracking);

        trackingInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleTracking();
            }
        });
    }

    const requestLookupForm = document.getElementById('requestLookupForm');
    const requestLookupResult = document.getElementById('requestLookupResult');
    if (requestLookupForm && requestLookupResult) {
        requestLookupForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const code = document.getElementById('requestLookupCode').value.trim();
            requestLookupResult.classList.remove('hidden');
            requestLookupResult.textContent = 'Checking your request…';
            try {
                const { data, error } = await supabase.rpc('lookup_customer_request', { p_lookup_code: code });
                if (error) throw error;
                if (!data || !data.found) throw new Error('not found');
                const labels = { new: 'Received', reviewing: 'Under review', quoted: 'Quote ready', read: 'Seen by our team', closed: 'Closed' };
                const status = String(data.status || 'new').toLowerCase();
                const kind = data.kind === 'quote' ? 'Quote request' : 'Contact message';
                const date = data.created_at ? new Date(data.created_at).toLocaleDateString() : '';
                requestLookupResult.classList.remove('lookup-error');
                requestLookupResult.replaceChildren();
                const typeLine = document.createElement('span');
                const statusLine = document.createElement('strong');
                const noteLine = document.createElement('span');
                typeLine.className = 'request-type';
                typeLine.textContent = `${kind}${date ? ` · Submitted ${date}` : ''}`;
                statusLine.textContent = labels[status] || status.replaceAll('_', ' ');
                noteLine.textContent = 'Our team will contact you using the details you provided.';
                requestLookupResult.append(typeLine, statusLine, noteLine);
            } catch (error) {
                requestLookupResult.textContent = 'We could not find that request. Check your reference code and try again.';
                requestLookupResult.classList.add('lookup-error');
            }
        });
    }


    async function handleTracking() {

        const trackingNum = trackingInput.value.trim();

        // Empty input
        if (!trackingNum) {

            trackingResult.classList.remove('hidden');
            trackingResult.classList.add('error');

            trackingResult.innerHTML = `
                <p style="color:#E53E3E; font-weight:600;">
                    Please enter a tracking number.
                </p>
            `;

            return;
        }


        // Loading state
        trackingResult.classList.remove('hidden');
        trackingResult.classList.remove('error');

        trackingResult.innerHTML = `
            <div style="text-align:center; padding:20px;">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <p>Checking shipment status...</p>
            </div>
        `;

        trackBtn.disabled = true;


        try {

            // Call the secure Supabase tracking function
            const { data, error } = await supabase.rpc(
                'track_shipment',
                {
                    p_tracking_number: trackingNum
                }
            );


            if (error) {
                console.error('Tracking error:', error);
                throw error;
            }


            // Shipment not found
            if (!data || data.success === false) {

                trackingResult.classList.add('error');

                trackingResult.innerHTML = `
                    <p style="color:#E53E3E; font-weight:600;">
                        Tracking number not found.
                        Please check the tracking number and try again.
                    </p>
                `;

                return;
            }


            // =================================================
            // SHIPMENT FOUND
            // =================================================

            const shipment = data.shipment;
            const events = data.events || [];


            // Format date
            function formatDate(dateString) {

                if (!dateString) {
                    return 'N/A';
                }

                const date = new Date(dateString);

                if (isNaN(date.getTime())) {
                    return dateString;
                }

                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            }


            // Create timeline
            const timelineHTML = events.map((event, index) => {

                return `
                    <div class="timeline-item completed">

                        <div class="timeline-dot"></div>

                        <div class="timeline-content">

                            <h5>
                                ${escapeHTML(event.status || 'Status Update')}
                            </h5>

                            <small>
                                ${escapeHTML(event.location || '')}
                            </small>

                            ${
                                event.description
                                    ? `<p style="margin-top:5px;">
                                        ${escapeHTML(event.description)}
                                       </p>`
                                    : ''
                            }

                            <small style="display:block; margin-top:5px;">
                                ${formatDate(event.event_date)}
                            </small>

                        </div>

                    </div>
                `;

            }).join('');


            // =================================================
            // DISPLAY RESULT
            // =================================================

            trackingResult.classList.remove('error');

            trackingResult.innerHTML = `

                <div style="margin-bottom:20px;">

                    <h4 style="
                        color:var(--navy-blue);
                        margin-bottom:10px;
                    ">
                        Tracking Number:
                        ${escapeHTML(shipment.tracking_number)}
                    </h4>

                    <p>
                        <strong>Origin:</strong>
                        ${escapeHTML(shipment.origin)}
                    </p>

                    <p>
                        <strong>Destination:</strong>
                        ${escapeHTML(shipment.destination)}
                    </p>

                    <p>
                        <strong>Shipment Type:</strong>
                        ${escapeHTML(shipment.shipment_type || 'N/A')}
                    </p>

                    <p>
                        <strong>Shipment Date:</strong>
                        ${formatDate(shipment.shipment_date)}
                    </p>

                    <p>
                        <strong>Estimated Delivery:</strong>
                        ${formatDate(shipment.estimated_delivery)}
                    </p>

                    <p>
                        <strong>Status:</strong>

                        <span style="
                            color:var(--orange);
                            font-weight:bold;
                        ">
                            ${escapeHTML(shipment.current_status)}
                        </span>

                    </p>

                </div>


                <div class="timeline">

                    ${timelineHTML || `
                        <p>No tracking events available yet.</p>
                    `}

                </div>
            `;


        } catch (error) {

            console.error(error);

            trackingResult.classList.add('error');

            trackingResult.innerHTML = `
                <p style="color:#E53E3E; font-weight:600;">
                    Unable to check the shipment right now.
                    Please try again later.
                </p>
            `;

        } finally {

            trackBtn.disabled = false;

        }
    }


    // =========================================================
    // SECURITY HELPER
    // Prevent HTML injection when displaying database data
    // =========================================================

    function escapeHTML(value) {

        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }


    // =========================================================
    // 3. FAQ ACCORDION
    // =========================================================

    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {

        const question = item.querySelector('.faq-question');

        if (!question) {
            return;
        }

        question.setAttribute('role', 'button');
        question.setAttribute('tabindex', '0');
        question.setAttribute('aria-expanded', 'false');

        const toggleQuestion = () => {

            const isActive = item.classList.contains('active');

            faqItems.forEach(faq => {

                faq.classList.remove('active');
                const faqQuestion = faq.querySelector('.faq-question');
                if (faqQuestion) faqQuestion.setAttribute('aria-expanded', 'false');

                const answer = faq.querySelector('.faq-answer');

                if (answer) {
                    answer.style.maxHeight = null;
                }

            });


            if (!isActive) {

                item.classList.add('active');
                question.setAttribute('aria-expanded', 'true');

                const answer = item.querySelector('.faq-answer');

                if (answer) {
                    answer.style.maxHeight =
                        answer.scrollHeight + 'px';
                }

            }

        };

        question.addEventListener('click', toggleQuestion);
        question.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleQuestion();
            }
        });

    });


    // =========================================================
    // 4. QUOTE FORM → SUPABASE
    // =========================================================

    const quoteForm = document.getElementById('quoteForm');
    const quoteSuccess = document.getElementById('quoteSuccess');


    if (quoteForm) {

        quoteForm.addEventListener('submit', async (e) => {

            e.preventDefault();


            if (!quoteForm.checkValidity()) {

                quoteForm.reportValidity();

                return;
            }


            const submitButton =
                quoteForm.querySelector('button[type="submit"]');


            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Submitting...';
            }


            try {

                const lookupCode = crypto.randomUUID();
                const quoteData = {
                    lookup_code: lookupCode,

                    name:
                        document.getElementById('quoteName').value.trim(),

                    email:
                        document.getElementById('quoteEmail').value.trim(),

                    phone:
                        document.getElementById('quotePhone').value.trim(),

                    pickup_location:
                        document.getElementById('quotePickup').value.trim(),

                    destination_country:
                        document.getElementById('quoteCountry').value.trim(),

                    destination_city:
                        document.getElementById('quoteCity').value.trim(),

                    // Retain compatibility with existing tables that require
                    // a single destination field as well as country and city.
                    destination:
                        [
                            document.getElementById('quoteCity').value.trim(),
                            document.getElementById('quoteCountry').value.trim()
                        ].filter(Boolean).join(', '),

                    shipment_type:
                        document.getElementById('quoteType').value,

                    weight:
                        parseFloat(
                            document.getElementById('quoteWeight').value
                        ) || null,

                    package_count:
                        parseInt(
                            document.getElementById('quotePackages').value
                        ) || 1,

                    pickup_date:
                        document.getElementById('quoteDate').value || null,

                    message:
                        document.getElementById('quoteMessage').value.trim()

                };


                const { error } = await supabase
                    .from('quote_requests')
                    .insert([quoteData]);


                if (error) {

                    console.error('Quote error:', error);

                    throw error;
                }


                const quoteEmailResponse = await fetch(`${NOTIFICATION_API_URL}/api/notifications/request`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind: 'quote', lookup_code: lookupCode })
                }).catch(() => null);
                const quoteEmail = quoteEmailResponse?.ok ? await quoteEmailResponse.json() : null;
                quoteSuccess.textContent =
                    'Your request is in. We’ll review the route and package details, then contact you using the information provided. For urgent requests, call 01-4500711.';

                quoteSuccess.textContent = `Quote request #${quoteEmail?.request_number || 'submitted'}. ${quoteEmail ? 'Confirmation email sent.' : 'Email notification could not be sent.'} Save this private status reference: ${lookupCode}`;
                quoteSuccess.classList.remove('hidden');

                quoteForm.reset();


                setTimeout(() => {
                    quoteSuccess.classList.add('hidden');
                }, 60000);


            } catch (error) {

                console.error(error);

                quoteSuccess.textContent =
                    'Sorry, your request could not be submitted. Please try again or call us directly.';

                quoteSuccess.style.color = '#E53E3E';

                quoteSuccess.classList.remove('hidden');

            } finally {

                if (submitButton) {

                    submitButton.disabled = false;

                    submitButton.textContent =
                        'Request a Quote';

                }

            }

        });

    }


    // =========================================================
    // 5. CONTACT FORM → SUPABASE
    // =========================================================

    const contactForm = document.getElementById('contactForm');
    const contactSuccess = document.getElementById('contactSuccess');


    if (contactForm) {

        contactForm.addEventListener('submit', async (e) => {

            e.preventDefault();


            if (!contactForm.checkValidity()) {

                contactForm.reportValidity();

                return;
            }


            const submitButton =
                contactForm.querySelector('button[type="submit"]');


            if (submitButton) {

                submitButton.disabled = true;

                submitButton.textContent =
                    'Sending...';

            }


            try {

                const lookupCode = crypto.randomUUID();
                const contactData = {
                    lookup_code: lookupCode,

                    name:
                        document.getElementById('contactName').value.trim(),

                    email:
                        document.getElementById('contactEmail').value.trim(),

                    phone:
                        document.getElementById('contactPhone').value.trim(),

                    subject:
                        document.getElementById('contactSubject').value.trim(),

                    message:
                        document.getElementById('contactMessage').value.trim()

                };


                const { error } = await supabase
                    .from('contact_messages')
                    .insert([contactData]);


                if (error) {

                    console.error('Contact error:', error);

                    throw error;
                }


                const messageEmailResponse = await fetch(`${NOTIFICATION_API_URL}/api/notifications/request`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind: 'message', lookup_code: lookupCode })
                }).catch(() => null);
                const messageEmail = messageEmailResponse?.ok ? await messageEmailResponse.json() : null;
                contactSuccess.textContent =
                    'Thank you! Your message has been sent successfully.';

                contactSuccess.style.color = '';

                contactSuccess.textContent = `Message #${messageEmail?.request_number || 'submitted'}. ${messageEmail ? 'Confirmation email sent.' : 'Email notification could not be sent.'} Save this private status reference: ${lookupCode}`;
                contactSuccess.classList.remove('hidden');

                contactForm.reset();


                setTimeout(() => {

                    contactSuccess.classList.add('hidden');

                }, 60000);


            } catch (error) {

                console.error(error);

                contactSuccess.textContent =
                    'Sorry, your message could not be sent. Please try again or call us directly.';

                contactSuccess.style.color =
                    '#E53E3E';

                contactSuccess.classList.remove('hidden');

            } finally {

                if (submitButton) {

                    submitButton.disabled = false;

                    submitButton.textContent =
                        'Send Message';

                }

            }

        });

    }

});
