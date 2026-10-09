//! WebKitGTK cannot allocate GBM buffers on the proprietary NVIDIA driver and
//! renders nothing. When an NVIDIA render node sits next to another GPU, point
//! WebKit at the other one. When NVIDIA is the only GPU there is nothing to
//! point at, so turn off WebKit's DMA-BUF renderer instead.

use std::fmt;

/// What to change in the environment so WebKit can render.
#[derive(Debug, PartialEq, Eq)]
pub enum GpuWorkaround {
    /// Set `WEBKIT_WEB_RENDER_DEVICE_FILE` to this non-NVIDIA render node.
    RenderNode(String),
    /// Set `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
    DisableDmabuf,
}

impl fmt::Display for GpuWorkaround {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RenderNode(node) => write!(f, "WEBKIT_WEB_RENDER_DEVICE_FILE={node}"),
            Self::DisableDmabuf => write!(f, "WEBKIT_DISABLE_DMABUF_RENDERER=1"),
        }
    }
}

/// `nodes` holds (render node path, kernel driver name) pairs.
/// Returns a non-NVIDIA node when NVIDIA and another GPU both exist, and
/// `DisableDmabuf` when every render node is NVIDIA.
pub fn pick_workaround(nodes: &[(String, String)]) -> Option<GpuWorkaround> {
    if !nodes.iter().any(|(_, driver)| driver == "nvidia") {
        return None;
    }
    Some(
        nodes
            .iter()
            .find(|(_, driver)| driver != "nvidia")
            .map_or(GpuWorkaround::DisableDmabuf, |(node, _)| {
                GpuWorkaround::RenderNode(node.clone())
            }),
    )
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

/// Sets the WebKit variable that fits this machine and returns what it did.
/// Does nothing when the user already set either variable.
/// Must run before any other thread exists: `set_var` is unsafe otherwise.
#[cfg(target_os = "linux")]
pub fn apply_linux_workaround() -> Option<GpuWorkaround> {
    const NODE_VAR: &str = "WEBKIT_WEB_RENDER_DEVICE_FILE";
    const DMABUF_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(NODE_VAR).is_some() || std::env::var_os(DMABUF_VAR).is_some() {
        return None;
    }
    let workaround = pick_workaround(&render_nodes())?;
    // SAFETY: called first thing in `run()`, before any thread is spawned.
    unsafe {
        match &workaround {
            GpuWorkaround::RenderNode(node) => std::env::set_var(NODE_VAR, node),
            GpuWorkaround::DisableDmabuf => std::env::set_var(DMABUF_VAR, "1"),
        }
    };
    Some(workaround)
}

#[cfg(not(target_os = "linux"))]
pub fn apply_linux_workaround() -> Option<GpuWorkaround> {
    None
}

#[cfg(test)]
mod tests {
    use super::{pick_workaround, GpuWorkaround};

    fn node(path: &str, driver: &str) -> (String, String) {
        (path.to_string(), driver.to_string())
    }

    #[test]
    fn picks_non_nvidia_node_when_nvidia_present() {
        let nodes = [node("/dev/dri/renderD128", "i915"), node("/dev/dri/renderD129", "nvidia")];
        assert_eq!(
            pick_workaround(&nodes),
            Some(GpuWorkaround::RenderNode("/dev/dri/renderD128".to_string()))
        );

        let nodes = [node("/dev/dri/renderD128", "nvidia"), node("/dev/dri/renderD129", "amdgpu")];
        assert_eq!(
            pick_workaround(&nodes),
            Some(GpuWorkaround::RenderNode("/dev/dri/renderD129".to_string()))
        );
    }

    #[test]
    fn leaves_machines_without_nvidia_alone() {
        assert_eq!(pick_workaround(&[node("/dev/dri/renderD128", "i915")]), None);
        assert_eq!(pick_workaround(&[]), None);
    }

    #[test]
    fn disables_dmabuf_on_nvidia_only_machines() {
        assert_eq!(
            pick_workaround(&[node("/dev/dri/renderD128", "nvidia")]),
            Some(GpuWorkaround::DisableDmabuf)
        );
        let nodes = [node("/dev/dri/renderD128", "nvidia"), node("/dev/dri/renderD129", "nvidia")];
        assert_eq!(pick_workaround(&nodes), Some(GpuWorkaround::DisableDmabuf));
    }

    #[test]
    fn describes_the_variable_it_sets() {
        let node = GpuWorkaround::RenderNode("/dev/dri/renderD128".to_string());
        assert_eq!(node.to_string(), "WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128");
        assert_eq!(GpuWorkaround::DisableDmabuf.to_string(), "WEBKIT_DISABLE_DMABUF_RENDERER=1");
    }
}
