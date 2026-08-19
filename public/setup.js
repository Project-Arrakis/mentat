/**
 * Setup Portal Client-Side JavaScript
 * 
 * Provides interactive functionality for the setup portal, including
 * adapter token generation.
 */

/**
 * Generate a random adapter token and populate the input field.
 * 
 * Uses crypto.getRandomValues() to generate a 32-byte random token,
 * then encodes it as hex. This matches the server's own token generation
 * pattern.
 */
function generateToken() {
  try {
    // Generate 32 random bytes (256 bits)
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    
    // Convert to hex string
    const token = Array.from(randomBytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    
    // Populate the input field
    const input = document.getElementById('adapterToken');
    if (input) {
      input.value = token;
      input.focus();
      // Flash the input to indicate it was populated
      input.style.backgroundColor = '#5aab61';
      setTimeout(() => {
        input.style.backgroundColor = '';
      }, 300);
      console.log('[ACP] Token generated successfully');
    } else {
      console.error('[ACP] adapterToken input not found');
    }
  } catch (error) {
    console.error('[ACP] Failed to generate token:', error);
    alert('Error generating token: ' + error.message);
  }
}

// Verify script loaded
console.log('[ACP] setup.js loaded');
