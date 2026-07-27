<?php
/**
 * Plugin Name: SBS Product Enquiry
 * Plugin URI:  https://selectbranding.co.uk
 * Description: Adds a Product Enquiry tab to WooCommerce product pages with a contact form (Name, Email, Phone, Message, T&C consent, math CAPTCHA). Emails results via wp_mail.
 * Version:     1.0.0
 * Author:      Select Branding Solutions
 * Text Domain: sbs-enquiry
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 8.0
 */

defined('ABSPATH') || exit;

add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) return;
    new SBS_Product_Enquiry_Admin();
    new SBS_Product_Enquiry_Form();
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Settings
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Product_Enquiry_Admin {

    public function __construct() {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_init', [$this, 'register_settings']);
        // Enquiries list
        add_action('admin_menu', [$this, 'enquiries_menu']);
    }

    public function menu(): void {
        add_submenu_page(
            'woocommerce',
            'Product Enquiry Settings',
            'Enquiry Settings',
            'manage_woocommerce',
            'sbs-enquiry-settings',
            [$this, 'settings_page']
        );
    }

    public function enquiries_menu(): void {
        add_submenu_page(
            'woocommerce',
            'Product Enquiries',
            'Product Enquiries',
            'manage_woocommerce',
            'sbs-enquiries',
            [$this, 'enquiries_page']
        );
    }

    public function register_settings(): void {
        register_setting('sbs_enquiry', 'sbs_enquiry_recipient',  ['default' => get_option('admin_email')]);
        register_setting('sbs_enquiry', 'sbs_enquiry_tab_label',  ['default' => 'Product Enquiry']);
        register_setting('sbs_enquiry', 'sbs_enquiry_tc_text',    ['default' => 'I Agree to your T&Cs and Consent to having my Data Stored and Collected']);
        register_setting('sbs_enquiry', 'sbs_enquiry_success_msg',['default' => 'Thank you for your enquiry! We\'ll be in touch within 1 business day.']);
        register_setting('sbs_enquiry', 'sbs_enquiry_store_db',   ['default' => '1']);
    }

    public function settings_page(): void { ?>
        <div class="wrap">
            <h1>Product Enquiry Settings</h1>
            <form method="post" action="options.php">
                <?php settings_fields('sbs_enquiry'); ?>
                <table class="form-table">
                    <tr><th>Recipient Email</th><td><input type="email" name="sbs_enquiry_recipient" value="<?=esc_attr(get_option('sbs_enquiry_recipient', get_option('admin_email')))?>" class="regular-text"></td></tr>
                    <tr><th>Tab Label</th><td><input type="text" name="sbs_enquiry_tab_label" value="<?=esc_attr(get_option('sbs_enquiry_tab_label','Product Enquiry'))?>" class="regular-text"></td></tr>
                    <tr><th>T&amp;C Checkbox Text</th><td><input type="text" name="sbs_enquiry_tc_text" value="<?=esc_attr(get_option('sbs_enquiry_tc_text','I Agree to your T&Cs and Consent to having my Data Stored and Collected'))?>" class="large-text"></td></tr>
                    <tr><th>Success Message</th><td><input type="text" name="sbs_enquiry_success_msg" value="<?=esc_attr(get_option('sbs_enquiry_success_msg','Thank you for your enquiry! We\'ll be in touch within 1 business day.'))?>" class="large-text"></td></tr>
                    <tr><th>Store in Database</th><td><label><input type="checkbox" name="sbs_enquiry_store_db" value="1" <?=checked(get_option('sbs_enquiry_store_db','1'),'1',false)?>> Save enquiries to database (for the Enquiries list)</label></td></tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
    <?php }

    public function enquiries_page(): void {
        global $wpdb;
        $table = $wpdb->prefix . 'sbs_enquiries';
        $rows  = $wpdb->get_results("SELECT * FROM {$table} ORDER BY created_at DESC LIMIT 200", ARRAY_A);
        ?>
        <div class="wrap">
            <h1>Product Enquiries</h1>
            <?php if (empty($rows)): ?>
            <p>No enquiries yet.</p>
            <?php else: ?>
            <table class="widefat striped">
                <thead><tr>
                    <th>Date</th><th>Product</th><th>Name</th><th>Email</th><th>Phone</th><th>Message</th>
                </tr></thead>
                <tbody>
                    <?php foreach ($rows as $r): ?>
                    <tr>
                        <td><?=esc_html($r['created_at'])?></td>
                        <td><?=esc_html($r['product_name'])?></td>
                        <td><?=esc_html($r['customer_name'])?></td>
                        <td><a href="mailto:<?=esc_attr($r['email'])?>"><?=esc_html($r['email'])?></a></td>
                        <td><?=esc_html($r['phone']??'')?></td>
                        <td><?=esc_html(substr($r['message'],0,80)) . (strlen($r['message'])>80?'…':'')?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>
        <?php
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// FORM — Tab + AJAX submission
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Product_Enquiry_Form {

    public function __construct() {
        add_action('wp_loaded', [$this, 'maybe_create_table']);
        add_filter('woocommerce_product_tabs', [$this, 'add_tab']);
        add_action('wp_head',   [$this, 'styles']);
        add_action('wp_footer', [$this, 'scripts']);
        add_action('wp_ajax_sbs_product_enquiry',        [$this, 'handle_submission']);
        add_action('wp_ajax_nopriv_sbs_product_enquiry', [$this, 'handle_submission']);
    }

    public function maybe_create_table(): void {
        global $wpdb;
        $table   = $wpdb->prefix . 'sbs_enquiries';
        $charset = $wpdb->get_charset_collate();
        if ($wpdb->get_var("SHOW TABLES LIKE '{$table}'") !== $table) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
            dbDelta("CREATE TABLE {$table} (
                id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                product_id    INT UNSIGNED NOT NULL,
                product_name  VARCHAR(255) NOT NULL,
                customer_name VARCHAR(255) NOT NULL,
                email         VARCHAR(255) NOT NULL,
                phone         VARCHAR(60)  NOT NULL DEFAULT '',
                message       TEXT         NOT NULL,
                created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) {$charset};");
        }
    }

    public function add_tab(array $tabs): array {
        $label = get_option('sbs_enquiry_tab_label', 'Product Enquiry');
        $tabs['sbs_enquiry'] = [
            'title'    => $label,
            'priority' => 45,
            'callback' => [$this, 'render_tab'],
        ];
        return $tabs;
    }

    public function styles(): void {
        if (!is_product()) return;
        echo '<style>
        .sbs-enquiry-form{max-width:700px}
        .sbs-enquiry-form .sbs-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px}
        .sbs-enquiry-form .sbs-row-full{margin-bottom:14px}
        .sbs-enquiry-form label{display:block;font-size:.85em;font-weight:600;margin-bottom:4px;color:#374151}
        .sbs-enquiry-form input[type=text],
        .sbs-enquiry-form input[type=email],
        .sbs-enquiry-form input[type=tel],
        .sbs-enquiry-form textarea{width:100%;border:1px solid #d1d5db;padding:9px 12px;font-size:.95em;border-radius:2px;box-sizing:border-box}
        .sbs-enquiry-form input:focus,
        .sbs-enquiry-form textarea:focus{outline:none;border-color:#1e3a5f;box-shadow:0 0 0 2px rgba(30,58,95,.15)}
        .sbs-enquiry-tc{display:flex;align-items:flex-start;gap:8px;margin-bottom:14px;font-size:.9em}
        .sbs-enquiry-captcha{display:flex;align-items:center;gap:12px;margin-bottom:14px}
        .sbs-enquiry-captcha input{width:100px}
        .sbs-enquiry-submit{background:#1e3a5f;color:#fff;border:none;padding:11px 28px;font-size:1em;font-weight:700;cursor:pointer;letter-spacing:.04em;text-transform:uppercase}
        .sbs-enquiry-submit:hover{background:#2d5491}
        .sbs-enquiry-message{padding:12px 16px;border-radius:4px;margin-top:14px;font-size:.95em;display:none}
        .sbs-enquiry-message.success{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
        .sbs-enquiry-message.error{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
        </style>';
    }

    public function scripts(): void {
        if (!is_product()) return; ?>
        <script>
        document.addEventListener('DOMContentLoaded', function(){
            var form = document.getElementById('sbs-enquiry-form');
            if(!form) return;
            form.addEventListener('submit', function(e){
                e.preventDefault();
                var btn = form.querySelector('.sbs-enquiry-submit');
                btn.disabled = true;
                btn.textContent = 'Sending…';
                var data = new FormData(form);
                data.append('action', 'sbs_product_enquiry');
                data.append('nonce', sbsEnquiry.nonce);
                fetch(sbsEnquiry.ajaxUrl, { method:'POST', body:data })
                    .then(r=>r.json()).then(function(res){
                        var msg = document.getElementById('sbs-enquiry-msg');
                        msg.style.display='block';
                        if(res.success){
                            msg.className='sbs-enquiry-message success';
                            msg.textContent=res.data;
                            form.reset();
                        } else {
                            msg.className='sbs-enquiry-message error';
                            msg.textContent=res.data||'An error occurred. Please try again.';
                        }
                        btn.disabled=false;
                        btn.textContent='SEND';
                    });
            });
        });
        </script>
        <?php
        wp_localize_script('jquery', 'sbsEnquiry', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('sbs_enquiry'),
        ]);
    }

    public function render_tab(): void {
        global $product;
        // Generate a simple math CAPTCHA
        $a = wp_rand(1, 9);
        $b = wp_rand(1, 9);
        $tc_text = get_option('sbs_enquiry_tc_text', 'I Agree to your T&Cs and Consent to having my Data Stored and Collected');
        ?>
        <form id="sbs-enquiry-form" class="sbs-enquiry-form" novalidate>
            <input type="hidden" name="product_id"   value="<?= esc_attr($product->get_id()) ?>">
            <input type="hidden" name="product_name" value="<?= esc_attr($product->get_name()) ?>">
            <input type="hidden" name="captcha_a"    value="<?= $a ?>">
            <input type="hidden" name="captcha_b"    value="<?= $b ?>">

            <div class="sbs-row">
                <div>
                    <label>Name <span style="color:red">*</span></label>
                    <input type="text" name="customer_name" required>
                </div>
                <div>
                    <label>Email <span style="color:red">*</span></label>
                    <input type="email" name="email" required>
                </div>
                <div>
                    <label>Phone</label>
                    <input type="tel" name="phone">
                </div>
            </div>

            <div class="sbs-row-full">
                <label>Message <span style="color:red">*</span></label>
                <textarea name="message" rows="5" required></textarea>
            </div>

            <div class="sbs-enquiry-tc">
                <input type="checkbox" name="tc_agree" id="sbs-tc" required style="margin-top:2px">
                <label for="sbs-tc"><?= esc_html($tc_text) ?> <span style="color:red">*</span></label>
            </div>

            <div class="sbs-enquiry-captcha">
                <label>What is <?= $a ?> + <?= $b ?>?</label>
                <input type="number" name="captcha_answer" required>
            </div>

            <button type="submit" class="sbs-enquiry-submit">SEND</button>
            <div id="sbs-enquiry-msg" class="sbs-enquiry-message"></div>
        </form>
        <?php
    }

    public function handle_submission(): void {
        check_ajax_referer('sbs_enquiry', 'nonce');

        // CAPTCHA
        $a      = (int) ($_POST['captcha_a'] ?? 0);
        $b      = (int) ($_POST['captcha_b'] ?? 0);
        $answer = (int) ($_POST['captcha_answer'] ?? -1);
        if ($answer !== ($a + $b)) {
            wp_send_json_error('Incorrect CAPTCHA answer. Please try again.');
        }

        // T&C
        if (empty($_POST['tc_agree'])) {
            wp_send_json_error('You must agree to the Terms & Conditions.');
        }

        $name       = sanitize_text_field($_POST['customer_name'] ?? '');
        $email      = sanitize_email($_POST['email'] ?? '');
        $phone      = sanitize_text_field($_POST['phone'] ?? '');
        $message    = sanitize_textarea_field($_POST['message'] ?? '');
        $product_id = (int) ($_POST['product_id'] ?? 0);
        $product_nm = sanitize_text_field($_POST['product_name'] ?? 'Unknown');

        if (!$name || !$email || !$message) {
            wp_send_json_error('Please fill in all required fields.');
        }
        if (!is_email($email)) {
            wp_send_json_error('Please enter a valid email address.');
        }

        // Store in DB
        if (get_option('sbs_enquiry_store_db', '1')) {
            global $wpdb;
            $wpdb->insert($wpdb->prefix . 'sbs_enquiries', [
                'product_id'   => $product_id,
                'product_name' => $product_nm,
                'customer_name'=> $name,
                'email'        => $email,
                'phone'        => $phone,
                'message'      => $message,
            ]);
        }

        // Email
        $to      = get_option('sbs_enquiry_recipient', get_option('admin_email'));
        $subject = sprintf('[Product Enquiry] %s — from %s', $product_nm, $name);
        $body    = "New product enquiry received.\n\n"
                 . "Product: {$product_nm} (ID: {$product_id})\n"
                 . "Name: {$name}\n"
                 . "Email: {$email}\n"
                 . "Phone: " . ($phone ?: 'Not provided') . "\n\n"
                 . "Message:\n{$message}";
        wp_mail($to, $subject, $body, [
            'Reply-To: ' . $name . ' <' . $email . '>',
        ]);

        $success = get_option('sbs_enquiry_success_msg', "Thank you for your enquiry! We'll be in touch within 1 business day.");
        wp_send_json_success($success);
    }
}
