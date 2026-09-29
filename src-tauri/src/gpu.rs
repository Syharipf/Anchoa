//! WebKitGTK cannot allocate GBM buffers on the proprietary NVIDIA driver and
//! renders nothing. When an NVIDIA render node sits next to another GPU, point
//! WebKit at the other one.

/// `nodes` holds (render node path, kernel driver name) pairs.
/// Returns the node to use only when NVIDIA and a non-NVIDIA node both exist.
pub fn pick_render_node(nodes: &[(String, String)]) -> Option<String> {
    if !nodes.iter().any(|(_, driver)| driver == "nvidia") {
        return None;
    }
    nodes
        .iter()
        .find(|(_, driver)| driver != "nvidia")
        .map(|(node, _)| node.clone())
}

#[cfg(target_os = "linux")]
fn render_nodes() -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir("/dev/dri") else {
        return Vec::new();
    };
    let mut nodes: Vec<(String, String)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("renderD") {
                return None;
            }
            let driver = std::fs::read_link(format!("/sys/class/drm/{name}/device/driver"))
                .ok()
                .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
                .unwrap_or_default();
            Some((format!("/dev/dri/{name}"), driver))
        })
        .collect();
    nodes.sort();
    nodes
}

/// Sets `WEBKIT_WEB_RENDER_DEVICE_FILE` when needed and returns the chosen node.
/// Must run before any other thread exists: `set_var` is unsafe otherwise.
#[cfg(target_os = "linux")]
pub fn apply_linux_workaround() -> Option<String> {
    const VAR: &str = "WEBKIT_WEB_RENDER_DEVICE_FILE";
    if std::env::var_os(VAR).is_some() {
        return None;
    }
    let node = pick_render_node(&render_nodes())?;
    // SAFETY: called first thing in `run()`, before any thread is spawned.
    unsafe { std::env::set_var(VAR, &node) };
    Some(node)
}

#[cfg(not(target_os = "linux"))]
pub fn apply_linux_workaround() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::pick_render_node;

    fn node(path: &str, driver: &str) -> (String, String) {
        (path.to_string(), driver.to_string())
    }

    #[test]
    fn picks_non_nvidia_node_when_nvidia_present() {
        let nodes = [node("/dev/dri/renderD128", "i915"), node("/dev/dri/renderD129", "nvidia")];
        assert_eq!(pick_render_node(&nodes), Some("/dev/dri/renderD128".to_string()));

        let nodes = [node("/dev/dri/renderD128", "nvidia"), node("/dev/dri/renderD129", "amdgpu")];
        assert_eq!(pick_render_node(&nodes), Some("/dev/dri/renderD129".to_string()));
    }

    #[test]
    fn leaves_machines_without_nvidia_alone() {
        assert_eq!(pick_render_node(&[node("/dev/dri/renderD128", "i915")]), None);
        assert_eq!(pick_render_node(&[]), None);
    }

    #[test]
    fn leaves_nvidia_only_machines_alone() {
        assert_eq!(pick_render_node(&[node("/dev/dri/renderD128", "nvidia")]), None);
    }
}
