import java.util.*;

public class Internal {
	private final Map<String, String> checkedOutDevices = new HashMap<>();

	public boolean checkoutDevice(String studentId, String deviceId) {
		if (studentId == null || studentId.isBlank() || deviceId == null || deviceId.isBlank()) {
			return false;
		}
		checkedOutDevices.put(studentId, deviceId);
		return true;
	}

	public Optional<String> findDeviceForStudent(String studentId) {
		if (studentId == null || studentId.isBlank()) {
			return Optional.empty();
		}
		return Optional.ofNullable(checkedOutDevices.get(studentId));
	}

	public boolean checkinDevice(String studentId) {
		if (studentId == null || studentId.isBlank()) {
			return false;
		}
		return checkedOutDevices.remove(studentId) != null;
	}

	public Map<String, String> getAllCheckouts() {
		return Map.copyOf(checkedOutDevices);
	}
}
