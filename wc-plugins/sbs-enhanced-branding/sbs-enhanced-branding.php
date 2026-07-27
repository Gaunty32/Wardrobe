<?php
/**
 * Plugin Name: SBS Enhanced Branding
 * Plugin URI:  https://selectbranding.co.uk
 * Description: Adds logo location selection tabs (Free Logo Application + Additional Logos) to WooCommerce product pages. Customers choose where they want their logo applied; extra costs are added to the cart.
 * Version:     1.0.0
 * Author:      Select Branding Solutions
 * Text Domain: sbs-branding
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 8.0
 */

defined('ABSPATH') || exit;

// Default logo locations available across all products
define('SBS_BRANDING_DEFAULT_LOCATIONS', [
    ['id' => 'left_chest',   'name' => 'Left Chest',   'description' => 'Standard primary position', 'cost' => 0.00,  'free' => true],
    ['id' => 'right_chest',  'name' => 'Right Chest',  'description' => 'Secondary chest position',  'cost' => 3.50,  'free' => false],
    ['id' => 'left_sleeve',  'name' => 'Left Sleeve',  'description' => 'Upper sleeve branding',      'cost' => 3.50,  'free' => false],
    ['id' => 'right_sleeve', 'name' => 'Right Sleeve', 'description' => 'Upper sleeve branding',      'cost' => 3.50,  'free' => false],
    ['id' => 'back_top',     'name' => 'Back (Top)',   'description' => 'Upper back panel',           'cost' => 5.00,  'free' => false],
    ['id' => 'back_centre',  'name' => 'Back (Centre)','description' => 'Central back panel',         'cost' => 5.00,  'free' => false],
    ['id' => 'collar',       'name' => 'Collar / Neck','description' => 'Inside or outside collar',   'cost' => 2.50,  'free' => false],
    ['id' => 'cap_front',    'name' => 'Cap Front',    'description' => 'Front panel of cap/hat',     'cost' => 0.00,  'free' => true],
    ['id' => 'cap_side',     'name' => 'Cap Side',     'description' => 'Side panel of cap/hat',      'cost' => 2.50,  'free' => false],
]);

add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) return;
    new SBS_Branding_Admin();
    new SBS_Branding_Display();
    new SBS_Branding_Cart();
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Settings page + per-product meta
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Branding_Admin {

    public function __construct() {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('add_meta_boxes', [$this, 'register_meta_box']);
        add_action('woocommerce_process_product_meta', [$this, 'save_meta']);
    }

    public function menu(): void {
        add_submenu_page(
            'woocommerce',
            'SBS Branding Locations',
            'Branding Locations',
            'manage_woocommerce',
            'sbs-branding-settings',
            [$this, 'settings_page']
        );
    }

    public function register_settings(): void {
        register_setting('sbs_branding', 'sbs_branding_locations', [
            'sanitize_callback' => [$this, 'sanitize_locations'],
        ]);
        register_setting('sbs_branding', 'sbs_branding_free_label',    ['default' => 'Free Logo Application']);
        register_setting('sbs_branding', 'sbs_branding_extra_label',   ['default' => 'Additional Logos']);
        register_setting('sbs_branding', 'sbs_branding_free_note',     ['default' => 'Your first logo position is included free with every order.']);
        register_setting('sbs_branding', 'sbs_branding_logo_formats',  ['default' => 'We accept: AI, EPS, SVG, PDF (vector), PNG at 300dpi+.']);
    }

    public function sanitize_locations($input): string {
        if (is_array($input)) return wp_json_encode($input);
        return $input;
    }

    public function settings_page(): void {
        $raw_locations = get_option('sbs_branding_locations', '');
        $locations = $raw_locations ? json_decode($raw_locations, true) : SBS_BRANDING_DEFAULT_LOCATIONS;
        if (!$locations) $locations = SBS_BRANDING_DEFAULT_LOCATIONS;
        ?>
        <div class="wrap">
            <h1>SBS Branding Locations</h1>
            <form method="post" action="options.php">
                <?php settings_fields('sbs_branding'); ?>
                <table class="form-table">
                    <tr><th>Free Tab Label</th><td><input type="text" name="sbs_branding_free_label"  value="<?= esc_attr(get_option('sbs_branding_free_label', 'Free Logo Application')) ?>" class="regular-text"></td></tr>
                    <tr><th>Extra Tab Label</th><td><input type="text" name="sbs_branding_extra_label" value="<?= esc_attr(get_option('sbs_branding_extra_label', 'Additional Logos')) ?>"      class="regular-text"></td></tr>
                    <tr><th>Free position note</th><td><input type="text" name="sbs_branding_free_note"    value="<?= esc_attr(get_option('sbs_branding_free_note',  'Your first logo position is included free with every order.')) ?>" class="large-text"></td></tr>
                    <tr><th>Accepted formats note</th><td><input type="text" name="sbs_branding_logo_formats" value="<?= esc_attr(get_option('sbs_branding_logo_formats', 'We accept: AI, EPS, SVG, PDF (vector), PNG at 300dpi+.')) ?>" class="large-text"></td></tr>
                </table>

                <h2>Logo Locations</h2>
                <p>Configure all available branding positions. Mark a position as "free" to list it under the Free Logo Application tab. Others appear under Additional Logos.</p>
                <table class="widefat" id="sbs-locations-table">
                    <thead><tr>
                        <th>ID (no spaces)</th><th>Name</th><th>Description</th>
                        <th>Extra Cost (£)</th><th>Free?</th><th></th>
                    </tr></thead>
                    <tbody>
                        <?php foreach ($locations as $i => $loc): ?>
                        <tr>
                            <td><input type="text" name="sbs_branding_locations[<?=$i?>][id]"          value="<?=esc_attr($loc['id'])?>"></td>
                            <td><input type="text" name="sbs_branding_locations[<?=$i?>][name]"        value="<?=esc_attr($loc['name'])?>"></td>
                            <td><input type="text" name="sbs_branding_locations[<?=$i?>][description]" value="<?=esc_attr($loc['description']??'')?>"></td>
                            <td><input type="number" name="sbs_branding_locations[<?=$i?>][cost]"      value="<?=esc_attr($loc['cost']??0)?>" step="0.01" min="0" style="width:80px"></td>
                            <td><input type="checkbox" name="sbs_branding_locations[<?=$i?>][free]"    value="1" <?=!empty($loc['free'])?'checked':''?>></td>
                            <td><button type="button" onclick="this.closest('tr').remove()" style="color:red;background:none;border:none;cursor:pointer">✕</button></td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
                <p><button type="button" id="sbs-add-location" class="button">+ Add Location</button></p>
                <script>
                document.getElementById('sbs-add-location').addEventListener('click', function(){
                    const tbody = document.querySelector('#sbs-locations-table tbody');
                    const i = tbody.rows.length;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td><input type="text" name="sbs_branding_locations[${i}][id]"></td>
                        <td><input type="text" name="sbs_branding_locations[${i}][name]"></td>
                        <td><input type="text" name="sbs_branding_locations[${i}][description]"></td>
                        <td><input type="number" name="sbs_branding_locations[${i}][cost]" step="0.01" min="0" style="width:80px" value="0"></td>
                        <td><input type="checkbox" name="sbs_branding_locations[${i}][free]" value="1"></td>
                        <td><button type="button" onclick="this.closest('tr').remove()" style="color:red;background:none;border:none;cursor:pointer">✕</button></td>`;
                    tbody.appendChild(tr);
                });
                </script>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    // Per-product: override which locations are available
    public function register_meta_box(): void {
        add_meta_box('sbs_branding_product', '🎨 SBS Branding Locations',
            [$this, 'render_meta'], 'product', 'normal', 'default');
    }

    public function render_meta(\WP_Post $post): void {
        wp_nonce_field('sbs_branding_meta', 'sbs_branding_meta_nonce');
        $override = get_post_meta($post->ID, '_sbs_branding_override', true);
        $disabled_ids = json_decode(get_post_meta($post->ID, '_sbs_branding_disabled', true) ?: '[]', true) ?: [];
        $raw = get_option('sbs_branding_locations', '');
        $locations = $raw ? json_decode($raw, true) : SBS_BRANDING_DEFAULT_LOCATIONS;
        ?>
        <p>
            <label>
                <input type="checkbox" name="sbs_branding_override" value="1" <?= checked($override, '1', false) ?>>
                Override global locations for this product (disable specific positions)
            </label>
        </p>
        <div id="sbs-product-locations" style="<?= $override ? '' : 'display:none' ?>">
            <p style="color:#666;font-size:13px">Uncheck any position to hide it for this product.</p>
            <?php foreach ($locations as $loc): ?>
            <label style="display:block;margin-bottom:4px">
                <input type="checkbox" name="sbs_branding_disabled_excl[]"
                       value="<?= esc_attr($loc['id']) ?>"
                       <?= !in_array($loc['id'], $disabled_ids) ? 'checked' : '' ?>>
                <?= esc_html($loc['name']) ?>
                <?= $loc['free'] ? '(Free)' : '(+£' . number_format((float)$loc['cost'], 2) . ')' ?>
            </label>
            <?php endforeach; ?>
        </div>
        <script>
        document.querySelector('[name="sbs_branding_override"]').addEventListener('change', function(){
            document.getElementById('sbs-product-locations').style.display = this.checked ? '' : 'none';
        });
        </script>
        <?php
    }

    public function save_meta(int $post_id): void {
        if (!isset($_POST['sbs_branding_meta_nonce']) || !wp_verify_nonce($_POST['sbs_branding_meta_nonce'], 'sbs_branding_meta')) return;
        $override = isset($_POST['sbs_branding_override']) ? '1' : '';
        update_post_meta($post_id, '_sbs_branding_override', $override);
        $enabled_ids  = array_map('sanitize_text_field', $_POST['sbs_branding_disabled_excl'] ?? []);
        $raw = get_option('sbs_branding_locations', '');
        $all_locations = $raw ? json_decode($raw, true) : SBS_BRANDING_DEFAULT_LOCATIONS;
        $all_ids = array_column($all_locations ?: [], 'id');
        $disabled = array_values(array_diff($all_ids, $enabled_ids));
        update_post_meta($post_id, '_sbs_branding_disabled', wp_json_encode($disabled));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// DISPLAY — Tabs on product page
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Branding_Display {

    public function __construct() {
        add_filter('woocommerce_product_tabs', [$this, 'add_tabs']);
        add_action('wp_head', [$this, 'styles']);
        add_action('wp_footer', [$this, 'scripts']);
    }

    public function styles(): void {
        if (!is_product()) return;
        echo '<style>
        .sbs-location-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px}
        .sbs-location-card{border:2px solid #e5e7eb;border-radius:8px;padding:14px;cursor:pointer;transition:border-color .2s,background .2s;position:relative}
        .sbs-location-card:hover{border-color:#93c5fd}
        .sbs-location-card.selected{border-color:#1e3a5f;background:#eff6ff}
        .sbs-location-card.free-loc{border-color:#d1fae5}
        .sbs-location-card.free-loc.selected{background:#f0fdf4;border-color:#15803d}
        .sbs-loc-name{font-weight:700;font-size:.95em;margin-bottom:2px}
        .sbs-loc-desc{font-size:.8em;color:#6b7280}
        .sbs-loc-cost{font-size:.85em;font-weight:600;margin-top:6px;color:#1d4ed8}
        .sbs-loc-free{font-size:.85em;font-weight:600;margin-top:6px;color:#15803d}
        .sbs-loc-check{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:#1e3a5f;color:#fff;display:none;align-items:center;justify-content:center;font-size:12px}
        .sbs-location-card.selected .sbs-loc-check{display:flex}
        .sbs-branding-note{background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:12px 16px;margin-bottom:14px;font-size:.9em;color:#0369a1}
        .sbs-selection-summary{margin-top:16px;padding:12px 16px;background:#f9fafb;border-radius:6px;font-size:.9em}
        .sbs-selection-summary strong{display:block;margin-bottom:6px}
        </style>';
    }

    public function scripts(): void {
        if (!is_product()) return;
        echo '<script>
        document.addEventListener("DOMContentLoaded", function(){
            document.querySelectorAll(".sbs-location-card").forEach(function(card){
                card.addEventListener("click", function(){
                    var isFree = card.classList.contains("free-loc");
                    if(isFree){
                        // Free: only one selectable at a time in the free tab
                        var tabContent = card.closest(".sbs-tab-section");
                        if(tabContent){
                            tabContent.querySelectorAll(".sbs-location-card.free-loc.selected").forEach(function(c){ if(c!==card) c.classList.remove("selected"); });
                        }
                    }
                    card.classList.toggle("selected");
                    sbs_update_summary();
                    sbs_update_hidden_inputs();
                });
            });
        });

        function sbs_update_summary(){
            var selected = [];
            var extra_cost = 0;
            document.querySelectorAll(".sbs-location-card.selected").forEach(function(c){
                var name = c.querySelector(".sbs-loc-name").textContent;
                var cost = parseFloat(c.dataset.cost||0);
                selected.push(name + (cost>0?" (+£"+cost.toFixed(2)+")":""));
                extra_cost += cost;
            });
            var el = document.getElementById("sbs-branding-summary");
            if(!el) return;
            if(selected.length===0){
                el.style.display="none";
            } else {
                el.style.display="block";
                el.querySelector(".sbs-summary-locations").textContent = selected.join(", ");
                el.querySelector(".sbs-summary-cost").textContent = extra_cost>0 ? "Logo extra cost: +£"+extra_cost.toFixed(2) : "No extra cost";
            }
        }

        function sbs_update_hidden_inputs(){
            var container = document.getElementById("sbs-branding-inputs");
            if(!container) return;
            container.innerHTML="";
            document.querySelectorAll(".sbs-location-card.selected").forEach(function(c, i){
                var input = document.createElement("input");
                input.type="hidden";
                input.name="sbs_logo_locations[]";
                input.value=c.dataset.locationId;
                container.appendChild(input);
                if(parseFloat(c.dataset.cost)>0){
                    var cost_input = document.createElement("input");
                    cost_input.type="hidden";
                    cost_input.name="sbs_logo_costs["+c.dataset.locationId+"]";
                    cost_input.value=c.dataset.cost;
                    container.appendChild(cost_input);
                }
            });
        }
        </script>';
    }

    public function add_tabs(array $tabs): array {
        global $product;
        if (!$product) return $tabs;

        $locations = $this->get_product_locations($product->get_id());
        if (empty($locations)) return $tabs;

        $free_locs  = array_filter($locations, fn($l) => !empty($l['free']));
        $extra_locs = array_filter($locations, fn($l) => empty($l['free']));

        $free_label  = get_option('sbs_branding_free_label',  'Free Logo Application');
        $extra_label = get_option('sbs_branding_extra_label', 'Additional Logos');

        if (!empty($free_locs)) {
            $tabs['sbs_free_logo'] = [
                'title'    => $free_label . ' *',
                'priority' => 50,
                'callback' => function() use ($free_locs, $free_label) {
                    $this->render_tab($free_locs, $free_label, true);
                },
            ];
        }

        if (!empty($extra_locs)) {
            $tabs['sbs_extra_logos'] = [
                'title'    => $extra_label,
                'priority' => 55,
                'callback' => function() use ($extra_locs, $extra_label) {
                    $this->render_tab($extra_locs, $extra_label, false);
                },
            ];
        }

        return $tabs;
    }

    private function get_product_locations(int $product_id): array {
        $raw = get_option('sbs_branding_locations', '');
        $all = $raw ? json_decode($raw, true) : SBS_BRANDING_DEFAULT_LOCATIONS;
        if (!$all) $all = SBS_BRANDING_DEFAULT_LOCATIONS;

        $override = get_post_meta($product_id, '_sbs_branding_override', true);
        if ($override) {
            $disabled = json_decode(get_post_meta($product_id, '_sbs_branding_disabled', true) ?: '[]', true) ?: [];
            $all = array_values(array_filter($all, fn($l) => !in_array($l['id'], $disabled)));
        }
        return $all;
    }

    private function render_tab(array $locations, string $label, bool $is_free): void {
        $free_note     = get_option('sbs_branding_free_note',    'Your first logo position is included free with every order.');
        $formats_note  = get_option('sbs_branding_logo_formats', 'We accept: AI, EPS, SVG, PDF (vector), PNG at 300dpi+.');
        ?>
        <div class="sbs-tab-section">
            <?php if ($is_free): ?>
            <div class="sbs-branding-note">
                ✅ <?= esc_html($free_note) ?><br>
                <small><?= esc_html($formats_note) ?></small>
            </div>
            <?php else: ?>
            <div class="sbs-branding-note" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c">
                ➕ Additional logo positions are charged per location. Select all that apply.
            </div>
            <?php endif; ?>

            <div class="sbs-location-grid">
                <?php foreach ($locations as $loc): ?>
                <?php $cost = (float)($loc['cost'] ?? 0); $free = !empty($loc['free']); ?>
                <div class="sbs-location-card <?= $free ? 'free-loc' : '' ?>"
                     data-location-id="<?= esc_attr($loc['id']) ?>"
                     data-cost="<?= esc_attr($cost) ?>">
                    <div class="sbs-loc-check">✓</div>
                    <div class="sbs-loc-name"><?= esc_html($loc['name']) ?></div>
                    <?php if (!empty($loc['description'])): ?>
                    <div class="sbs-loc-desc"><?= esc_html($loc['description']) ?></div>
                    <?php endif; ?>
                    <?php if ($free): ?>
                    <div class="sbs-loc-free">✓ Included Free</div>
                    <?php else: ?>
                    <div class="sbs-loc-cost">+£<?= number_format($cost, 2) ?> per item</div>
                    <?php endif; ?>
                </div>
                <?php endforeach; ?>
            </div>

            <div id="sbs-branding-summary" class="sbs-selection-summary" style="display:none">
                <strong>Your logo selections:</strong>
                <span class="sbs-summary-locations"></span><br>
                <span class="sbs-summary-cost"></span>
            </div>
            <div id="sbs-branding-inputs"></div>
        </div>
        <?php
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CART — Store logo selections in cart item, add costs as fees
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Branding_Cart {

    public function __construct() {
        add_filter('woocommerce_add_cart_item_data', [$this, 'capture_selections'], 10, 3);
        add_filter('woocommerce_get_item_data',      [$this, 'display_item_data'],  10, 2);
        add_action('woocommerce_checkout_create_order_line_item', [$this, 'save_order_item_meta'], 10, 4);
        add_action('woocommerce_cart_calculate_fees', [$this, 'add_branding_fees']);
    }

    public function capture_selections(array $cart_item_data, int $product_id, int $variation_id): array {
        $locations = array_map('sanitize_text_field', $_POST['sbs_logo_locations'] ?? []);
        $costs     = array_map('floatval', $_POST['sbs_logo_costs'] ?? []);

        if (!empty($locations)) {
            $cart_item_data['sbs_logo_locations'] = $locations;
            $cart_item_data['sbs_logo_costs']     = $costs;
            $cart_item_data['sbs_unique_key']     = md5(microtime() . implode(',', $locations));
        }
        return $cart_item_data;
    }

    public function display_item_data(array $item_data, array $cart_item): array {
        if (empty($cart_item['sbs_logo_locations'])) return $item_data;
        $item_data[] = [
            'key'   => '🎨 Logo Positions',
            'value' => implode(', ', array_map('ucwords', str_replace('_', ' ', $cart_item['sbs_logo_locations']))),
        ];
        $total_cost = array_sum($cart_item['sbs_logo_costs'] ?? []);
        if ($total_cost > 0) {
            $item_data[] = [
                'key'   => 'Branding extra',
                'value' => '£' . number_format($total_cost * $cart_item['quantity'], 2),
            ];
        }
        return $item_data;
    }

    public function save_order_item_meta(\WC_Order_Item_Product $item, string $cart_item_key, array $values): void {
        if (!empty($values['sbs_logo_locations'])) {
            $item->add_meta_data('Logo Positions', implode(', ', $values['sbs_logo_locations']), true);
        }
        if (!empty($values['sbs_logo_costs']) && array_sum($values['sbs_logo_costs']) > 0) {
            $item->add_meta_data('Branding Extra (per item)', '£' . number_format(array_sum($values['sbs_logo_costs']), 2), true);
        }
    }

    public function add_branding_fees(\WC_Cart $cart): void {
        if (is_admin() && !defined('DOING_AJAX')) return;
        $total_fee = 0;
        foreach ($cart->get_cart() as $item) {
            if (empty($item['sbs_logo_costs'])) continue;
            $total_fee += array_sum($item['sbs_logo_costs']) * $item['quantity'];
        }
        if ($total_fee > 0) {
            $cart->add_fee('Additional Logo Positions', $total_fee, true);
        }
    }
}
