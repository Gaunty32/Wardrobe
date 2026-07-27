<?php
/**
 * Plugin Name: SBS Chat Widget
 * Plugin URI:  https://selectbranding.co.uk
 * Description: Adds a floating chat button to the front end. Configurable greeting, avatar photo, and action (live chat URL, WhatsApp, or email). Matches the Select Branding design.
 * Version:     1.0.0
 * Author:      Select Branding Solutions
 * Text Domain: sbs-chat
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

defined('ABSPATH') || exit;

add_action('plugins_loaded', function () {
    new SBS_Chat_Widget_Admin();
    new SBS_Chat_Widget_Frontend();
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Settings page
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Chat_Widget_Admin {

    public function __construct() {
        add_action('admin_menu',  [$this, 'menu']);
        add_action('admin_init',  [$this, 'register_settings']);
        add_action('admin_head',  [$this, 'avatar_uploader_scripts']);
    }

    public function menu(): void {
        add_submenu_page(
            'options-general.php',
            'SBS Chat Widget',
            'Chat Widget',
            'manage_options',
            'sbs-chat-widget',
            [$this, 'page']
        );
    }

    public function register_settings(): void {
        register_setting('sbs_chat', 'sbs_chat_enabled',        ['default' => '1']);
        register_setting('sbs_chat', 'sbs_chat_greeting',       ['default' => 'Hi there! Have a question?']);
        register_setting('sbs_chat', 'sbs_chat_subtext',        ['default' => 'Chat with us here.']);
        register_setting('sbs_chat', 'sbs_chat_avatar_url',     ['default' => '']);
        register_setting('sbs_chat', 'sbs_chat_action',         ['default' => 'email']); // email | whatsapp | url
        register_setting('sbs_chat', 'sbs_chat_email',          ['default' => get_option('admin_email')]);
        register_setting('sbs_chat', 'sbs_chat_whatsapp',       ['default' => '']);      // e.g. 447911123456
        register_setting('sbs_chat', 'sbs_chat_url',            ['default' => '']);
        register_setting('sbs_chat', 'sbs_chat_button_color',   ['default' => '#1e3a5f']);
        register_setting('sbs_chat', 'sbs_chat_delay',          ['default' => '3']);     // seconds before auto-open
        register_setting('sbs_chat', 'sbs_chat_pages',          ['default' => 'all']);   // all | product | home
        register_setting('sbs_chat', 'sbs_chat_offline_msg',    ['default' => "We're currently offline. Leave your email and we'll get back to you!"]);
        register_setting('sbs_chat', 'sbs_chat_show_offline',   ['default' => '']);
    }

    public function avatar_uploader_scripts(): void {
        $screen = get_current_screen();
        if (!$screen || $screen->id !== 'settings_page_sbs-chat-widget') return;
        wp_enqueue_media();
    }

    public function page(): void {
        $action        = get_option('sbs_chat_action', 'email');
        $pages         = get_option('sbs_chat_pages', 'all');
        $button_color  = get_option('sbs_chat_button_color', '#1e3a5f');
        $avatar        = get_option('sbs_chat_avatar_url', '');
        ?>
        <div class="wrap">
            <h1>SBS Chat Widget</h1>
            <form method="post" action="options.php">
                <?php settings_fields('sbs_chat'); ?>
                <table class="form-table">
                    <tr><th>Enable Widget</th><td><input type="checkbox" name="sbs_chat_enabled" value="1" <?=checked(get_option('sbs_chat_enabled','1'),'1',false)?>></td></tr>
                    <tr><th>Greeting (bold line)</th><td><input type="text" name="sbs_chat_greeting" value="<?=esc_attr(get_option('sbs_chat_greeting','Hi there! Have a question?'))?>" class="large-text"></td></tr>
                    <tr><th>Sub-text</th><td><input type="text" name="sbs_chat_subtext" value="<?=esc_attr(get_option('sbs_chat_subtext','Chat with us here.'))?>" class="large-text"></td></tr>
                    <tr><th>Avatar Photo URL</th><td>
                        <input type="text" name="sbs_chat_avatar_url" id="sbs_avatar_url" value="<?=esc_attr($avatar)?>" class="regular-text">
                        <button type="button" class="button" id="sbs-avatar-upload">Upload Photo</button>
                        <?php if ($avatar): ?><br><img src="<?=esc_url($avatar)?>" style="width:48px;height:48px;border-radius:50%;margin-top:6px;object-fit:cover"><?php endif; ?>
                        <script>
                        jQuery(function($){
                            $('#sbs-avatar-upload').click(function(){
                                var frame = wp.media({title:'Select Avatar',button:{text:'Use this photo'},multiple:false});
                                frame.on('select',function(){
                                    var url = frame.state().get('selection').first().toJSON().url;
                                    $('#sbs_avatar_url').val(url);
                                });
                                frame.open();
                            });
                        });
                        </script>
                    </td></tr>
                    <tr><th>Button Color</th><td><input type="color" name="sbs_chat_button_color" value="<?=esc_attr($button_color)?>"></td></tr>
                    <tr><th>Auto-open delay (seconds)</th><td><input type="number" name="sbs_chat_delay" value="<?=esc_attr(get_option('sbs_chat_delay','3'))?>" min="0" max="60" style="width:60px"> <em>(0 = do not auto-open)</em></td></tr>
                    <tr><th>Show on pages</th><td>
                        <select name="sbs_chat_pages">
                            <option value="all"     <?=selected($pages,'all',false)    ?>>All pages</option>
                            <option value="product" <?=selected($pages,'product',false)?>>Product pages only</option>
                            <option value="home"    <?=selected($pages,'home',false)   ?>>Home page only</option>
                        </select>
                    </td></tr>

                    <tr><th>Chat Action</th><td>
                        <label><input type="radio" name="sbs_chat_action" value="email"     <?=checked($action,'email',false)    ?>> Email</label>&nbsp;&nbsp;
                        <label><input type="radio" name="sbs_chat_action" value="whatsapp"  <?=checked($action,'whatsapp',false) ?>> WhatsApp</label>&nbsp;&nbsp;
                        <label><input type="radio" name="sbs_chat_action" value="url"       <?=checked($action,'url',false)      ?>> Custom URL</label>
                    </td></tr>
                    <tr><th>Email Address</th><td><input type="email" name="sbs_chat_email" value="<?=esc_attr(get_option('sbs_chat_email',get_option('admin_email')))?>" class="regular-text"></td></tr>
                    <tr><th>WhatsApp Number</th><td>
                        <input type="text" name="sbs_chat_whatsapp" value="<?=esc_attr(get_option('sbs_chat_whatsapp',''))?>" class="regular-text" placeholder="447911123456 (no + or spaces)">
                        <em>Full international format, no + or spaces</em>
                    </td></tr>
                    <tr><th>Custom Chat URL</th><td><input type="url" name="sbs_chat_url" value="<?=esc_attr(get_option('sbs_chat_url',''))?>" class="regular-text" placeholder="https://..."></td></tr>

                    <tr><th>Show Offline Mode</th><td><input type="checkbox" name="sbs_chat_show_offline" value="1" <?=checked(get_option('sbs_chat_show_offline',''),'1',false)?>></td></tr>
                    <tr><th>Offline Message</th><td><input type="text" name="sbs_chat_offline_msg" value="<?=esc_attr(get_option('sbs_chat_offline_msg',"We're currently offline. Leave your email and we'll get back to you!"))?>" class="large-text"></td></tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// FRONTEND — Widget output
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Chat_Widget_Frontend {

    public function __construct() {
        add_action('wp_footer', [$this, 'render']);
        add_action('wp_ajax_nopriv_sbs_offline_enquiry', [$this, 'offline_enquiry']);
        add_action('wp_ajax_sbs_offline_enquiry',        [$this, 'offline_enquiry']);
    }

    private function should_show(): bool {
        if (!get_option('sbs_chat_enabled', '1')) return false;
        $pages = get_option('sbs_chat_pages', 'all');
        if ($pages === 'product') return is_product();
        if ($pages === 'home')    return is_front_page();
        return true;
    }

    public function offline_enquiry(): void {
        check_ajax_referer('sbs_offline', 'nonce');
        $email = sanitize_email($_POST['email'] ?? '');
        if (!is_email($email)) wp_send_json_error('Please enter a valid email.');
        $to = get_option('sbs_chat_email', get_option('admin_email'));
        wp_mail($to, '[Chat Widget] Offline Enquiry', "Email: {$email}\nPage: " . sanitize_url($_POST['page'] ?? ''));
        wp_send_json_success("Thanks! We'll email you soon.");
    }

    public function render(): void {
        if (!$this->should_show()) return;

        $greeting      = get_option('sbs_chat_greeting', 'Hi there! Have a question?');
        $subtext       = get_option('sbs_chat_subtext',   'Chat with us here.');
        $avatar        = get_option('sbs_chat_avatar_url', '');
        $color         = get_option('sbs_chat_button_color', '#1e3a5f');
        $action        = get_option('sbs_chat_action', 'email');
        $email         = get_option('sbs_chat_email', get_option('admin_email'));
        $whatsapp      = get_option('sbs_chat_whatsapp', '');
        $custom_url    = get_option('sbs_chat_url', '');
        $delay         = (int) get_option('sbs_chat_delay', 3);
        $offline_mode  = get_option('sbs_chat_show_offline', '');
        $offline_msg   = get_option('sbs_chat_offline_msg', "We're currently offline.");

        // Build the action URL
        $href = '#';
        if ($action === 'email')    $href = 'mailto:' . $email;
        if ($action === 'whatsapp') $href = 'https://wa.me/' . preg_replace('/\D/', '', $whatsapp);
        if ($action === 'url')      $href = $custom_url ?: '#';

        $avatar_html = $avatar
            ? '<img src="' . esc_url($avatar) . '" alt="Chat" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid #fff">'
            : '<svg xmlns="http://www.w3.org/2000/svg" style="width:40px;height:40px" viewBox="0 0 24 24" fill="white"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>';
        ?>
        <style>
        #sbs-chat-wrapper{position:fixed;bottom:24px;right:24px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        #sbs-chat-bubble{background:<?=esc_attr($color)?>;border-radius:50px 50px 6px 50px;padding:14px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 24px rgba(0,0,0,.25);cursor:pointer;min-width:260px;text-decoration:none;color:#fff;transition:transform .2s,box-shadow .2s}
        #sbs-chat-bubble:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.3)}
        #sbs-chat-bubble.collapsed{min-width:auto;border-radius:50%;width:56px;height:56px;padding:0;justify-content:center}
        #sbs-chat-bubble.collapsed .sbs-chat-text{display:none}
        .sbs-chat-text strong{display:block;font-size:.9em;font-weight:700}
        .sbs-chat-text span{font-size:.8em;opacity:.85}
        #sbs-chat-close{position:absolute;top:-8px;right:-8px;background:#fff;color:<?=esc_attr($color)?>;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:14px;display:none;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2)}
        #sbs-chat-wrapper:not(.minimised) #sbs-chat-close{display:flex}
        #sbs-chat-offline{background:#fff;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.15);padding:16px;margin-bottom:12px;max-width:280px;display:none}
        #sbs-chat-offline p{margin:0 0 10px;font-size:.9em;color:#374151}
        #sbs-chat-offline input{width:100%;border:1px solid #d1d5db;padding:8px;border-radius:4px;font-size:.9em;box-sizing:border-box;margin-bottom:8px}
        #sbs-chat-offline button{background:<?=esc_attr($color)?>;color:#fff;border:none;padding:9px 18px;width:100%;cursor:pointer;font-weight:700;border-radius:4px}
        </style>

        <div id="sbs-chat-wrapper">
            <?php if ($offline_mode): ?>
            <div id="sbs-chat-offline">
                <p><?= esc_html($offline_msg) ?></p>
                <input type="email" id="sbs-offline-email" placeholder="Your email address">
                <button type="button" id="sbs-offline-send">Send</button>
                <div id="sbs-offline-msg" style="font-size:.85em;margin-top:6px;color:#15803d;display:none"></div>
            </div>
            <?php endif; ?>

            <?php if (!$offline_mode): ?>
            <a id="sbs-chat-bubble" href="<?= esc_url($href) ?>" target="_blank" rel="noopener">
            <?php else: ?>
            <div id="sbs-chat-bubble">
            <?php endif; ?>
                <button id="sbs-chat-close" type="button" aria-label="Minimise chat" title="Minimise">×</button>
                <?= $avatar_html ?>
                <div class="sbs-chat-text">
                    <strong><?= esc_html($greeting) ?></strong>
                    <span><?= esc_html($subtext) ?></span>
                </div>
            <?php echo $offline_mode ? '</div>' : '</a>'; ?>
        </div>

        <script>
        (function(){
            var wrapper = document.getElementById('sbs-chat-wrapper');
            var bubble  = document.getElementById('sbs-chat-bubble');
            var closeBtn= document.getElementById('sbs-chat-close');
            var minimised = false;

            function minimise(){
                minimised = true;
                bubble.classList.add('collapsed');
                wrapper.classList.add('minimised');
                localStorage.setItem('sbs_chat_min', '1');
            }
            function expand(){
                minimised = false;
                bubble.classList.remove('collapsed');
                wrapper.classList.remove('minimised');
                localStorage.removeItem('sbs_chat_min');
            }

            if(localStorage.getItem('sbs_chat_min')) { minimise(); }
            else if(<?= $delay ?> > 0){
                bubble.classList.add('collapsed');
                wrapper.classList.add('minimised');
                setTimeout(expand, <?= $delay * 1000 ?>);
            }

            if(closeBtn){
                closeBtn.addEventListener('click', function(e){
                    e.preventDefault(); e.stopPropagation();
                    minimise();
                });
            }

            if(bubble && <?= $offline_mode ? 'true' : 'false' ?>){
                bubble.addEventListener('click', function(e){
                    e.preventDefault();
                    var panel = document.getElementById('sbs-chat-offline');
                    if(panel) panel.style.display = panel.style.display==='none'?'block':'none';
                });
            }

            var offlineSend = document.getElementById('sbs-offline-send');
            if(offlineSend){
                offlineSend.addEventListener('click', function(){
                    var email = document.getElementById('sbs-offline-email').value;
                    var data  = new FormData();
                    data.append('action','sbs_offline_enquiry');
                    data.append('nonce','<?= wp_create_nonce('sbs_offline') ?>');
                    data.append('email', email);
                    data.append('page',  window.location.href);
                    fetch('<?= admin_url('admin-ajax.php') ?>',{method:'POST',body:data})
                        .then(r=>r.json()).then(function(res){
                            var msg = document.getElementById('sbs-offline-msg');
                            msg.textContent = res.data; msg.style.display='block';
                        });
                });
            }
        })();
        </script>
        <?php
    }
}
