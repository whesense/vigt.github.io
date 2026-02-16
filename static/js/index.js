window.HELP_IMPROVE_VIDEOJS = false;

// Auto-size embedded demo iframes to their content height.
// Each iframe posts { type: "vigt:iframeHeight", height } from shared/iframe_autoheight.js
(function setupIframeAutoHeight() {
    const clampIframeHeight = (rawHeight, wrap) => {
        const isTall = !!wrap?.classList?.contains('demo-embed--tall');
        const minHeight = isTall ? 380 : 320;
        const h = Math.round(rawHeight);
        // Keep only a broad safety cap so iframe demos can grow naturally.
        const maxHeight = 12000;
        return Math.max(minHeight, Math.min(h, maxHeight));
    };

    window.addEventListener('message', function(ev) {
        const data = ev?.data;
        if (!data || data.type !== 'vigt:iframeHeight') return;
        const h = Number(data.height);
        if (!Number.isFinite(h) || h < 100) return;

        const iframes = document.querySelectorAll('.demo-embed iframe');
        for (const iframe of iframes) {
            if (iframe.contentWindow === ev.source) {
                const wrap = iframe.closest('.demo-embed');
                const clamped = clampIframeHeight(h, wrap);
                iframe.style.height = `${clamped}px`;
                if (wrap) wrap.style.height = `${clamped}px`;
                break;
            }
        }
    });
})();

// Load/unload interactive demos on toggle to balance quick access and performance.
(function setupDemoToggle() {
    const buttons = document.querySelectorAll('[data-demo-toggle]');
    if (!buttons.length) return;

    const resolveSrc = (iframe) => {
        const src = iframe?.dataset?.src;
        if (!src) return null;
        try {
            return new URL(src, window.location.href).toString();
        } catch (err) {
            return src;
        }
    };

    for (const button of buttons) {
        const targetId = button.getAttribute('aria-controls');
        if (!targetId) continue;
        const iframe = document.getElementById(targetId);
        if (!iframe) continue;
        const shell = iframe.closest('[data-demo-shell]');
        const labelEl = button.querySelector('.demo-toggle__label');

        const setLabel = (text) => {
            if (labelEl) {
                labelEl.textContent = text;
            } else {
                button.textContent = text;
            }
        };

        // Ensure initial collapsed state.
        button.setAttribute('aria-expanded', 'false');
        if (shell) shell.dataset.state = 'collapsed';
        iframe.hidden = true;

        button.addEventListener('click', function() {
            const expanded = button.getAttribute('aria-expanded') === 'true';
            if (!expanded) {
                const targetSrc = resolveSrc(iframe);
                if (!targetSrc) return;
                button.setAttribute('aria-expanded', 'true');
                if (shell) shell.dataset.state = 'loading';
                setLabel('Loading...');
                iframe.hidden = false;

                const onLoad = () => {
                    if (button.getAttribute('aria-expanded') !== 'true') return;
                    if (shell) shell.dataset.state = 'loaded';
                    setLabel('Hide demo');
                };

                const onError = () => {
                    if (button.getAttribute('aria-expanded') !== 'true') return;
                    if (shell) shell.dataset.state = 'collapsed';
                    button.setAttribute('aria-expanded', 'false');
                    setLabel('Show demo');
                    iframe.hidden = true;
                    iframe.src = 'about:blank';
                };

                iframe.addEventListener('load', onLoad, { once: true });
                iframe.addEventListener('error', onError, { once: true });
                iframe.src = targetSrc;
                return;
            }

            button.setAttribute('aria-expanded', 'false');
            setLabel('Show demo');
            if (shell) shell.dataset.state = 'collapsed';
            iframe.hidden = true;
            iframe.src = 'about:blank';
            iframe.style.height = '';
            const wrap = iframe.closest('.demo-embed');
            if (wrap) wrap.style.height = '';
        });
    }
})();

// More Works Dropdown Functionality
function toggleMoreWorks() {
    const dropdown = document.getElementById('moreWorksDropdown');
    const button = document.querySelector('.more-works-btn');

    if (!dropdown || !button) return;
    
    if (dropdown.classList.contains('show')) {
        dropdown.classList.remove('show');
        button.classList.remove('active');
    } else {
        dropdown.classList.add('show');
        button.classList.add('active');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const container = document.querySelector('.more-works-container');
    const dropdown = document.getElementById('moreWorksDropdown');
    const button = document.querySelector('.more-works-btn');
    
    if (container && !container.contains(event.target)) {
        dropdown?.classList.remove('show');
        button?.classList.remove('active');
    }
});

// Close dropdown on escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const dropdown = document.getElementById('moreWorksDropdown');
        const button = document.querySelector('.more-works-btn');
        dropdown?.classList.remove('show');
        button?.classList.remove('active');
    }
});

// Copy BibTeX to clipboard
function copyBibTeX() {
    const bibtexElement = document.getElementById('bibtex-code');
    const button = document.querySelector('.copy-bibtex-btn');
    if (!bibtexElement || !button) return;

    const copyText = button.querySelector('.copy-text');
    if (!copyText) return;
    
    navigator.clipboard.writeText(bibtexElement.textContent).then(function() {
        // Success feedback
        button.classList.add('copied');
        copyText.textContent = 'Cop';
        
        setTimeout(function() {
            button.classList.remove('copied');
            copyText.textContent = 'Copy';
        }, 2000);
    }).catch(function(err) {
        console.error('Failed to copy: ', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = bibtexElement.textContent;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        button.classList.add('copied');
        copyText.textContent = 'Cop';
        setTimeout(function() {
            button.classList.remove('copied');
            copyText.textContent = 'Copy';
        }, 2000);
    });
}

// Scroll to top functionality
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// Show/hide scroll to top button
window.addEventListener('scroll', function() {
    const scrollButton = document.querySelector('.scroll-to-top');
    if (window.pageYOffset > 300) {
        scrollButton.classList.add('visible');
    } else {
        scrollButton.classList.remove('visible');
    }
});

// Video carousel autoplay when in view
function setupVideoCarouselAutoplay() {
    const carouselVideos = document.querySelectorAll('.results-carousel video');
    
    if (carouselVideos.length === 0) return;
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            if (entry.isIntersecting) {
                // Video is in view, play it
                video.play().catch(e => {
                    // Autoplay failed, probably due to browser policy
                    console.log('Autoplay prevented:', e);
                });
            } else {
                // Video is out of view, pause it
                video.pause();
            }
        });
    }, {
        threshold: 0.5 // Trigger when 50% of the video is visible
    });
    
    carouselVideos.forEach(video => {
        observer.observe(video);
    });
}

$(document).ready(function() {
    // Check for click events on the navbar burger icon

    var options = {
		slidesToScroll: 1,
		slidesToShow: 1,
		loop: true,
		infinite: true,
		autoplay: true,
		autoplaySpeed: 5000,
    }

	// Initialize all div with carousel class (if the lib is present)
    if (typeof bulmaCarousel !== 'undefined') {
        bulmaCarousel.attach('.carousel', options);
    }
	
    if (typeof bulmaSlider !== 'undefined') {
        bulmaSlider.attach();
    }
    
    // Setup video autoplay for carousel
    setupVideoCarouselAutoplay();

})
