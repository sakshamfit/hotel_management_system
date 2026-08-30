import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, HotelService, Department } from '../../types';
import {
  Layers,
  Plus,
  Edit2,
  Clock,
  Trash2,
  X,
  Search,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

const DEPARTMENT_OPTIONS: { value: Department; label: string }[] = [
  { value: 'HOUSEKEEPING', label: 'Housekeeping' },
  { value: 'WATER_BEVERAGES', label: 'Water & Beverages' },
  { value: 'AMENITIES', label: 'Amenities' },
  { value: 'MAINTENANCE', label: 'Maintenance / Engineering' },
  { value: 'RECEPTION', label: 'Reception / Front Desk' },
];

export const ServicesTab: React.FC<Props> = ({ hotel }) => {
  const [services, setServices] = useState<HotelService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<HotelService | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Housekeeping');
  const [department, setDepartment] = useState<Department>('HOUSEKEEPING');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0');
  const [slaMinutes, setSlaMinutes] = useState('15');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = firestoreService.subscribeServices(
      hotel.id,
      (fetchedServices) => {
        setServices(fetchedServices);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching services:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const filteredServices = services.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (s.categoryId && s.categoryId.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  const handleToggleAvailability = async (service: HotelService) => {
    try {
      await firestoreService.updateService(hotel.id, service.id, {
        isAvailable: !service.isAvailable,
      });
    } catch (err: any) {
      alert(`Error updating availability: ${err.message}`);
    }
  };

  const handleOpenEdit = (s?: HotelService) => {
    if (s) {
      setEditingService(s);
      setName(s.name);
      setCategory(s.categoryId || 'Housekeeping');
      setDepartment((s.department as Department) || 'HOUSEKEEPING');
      setDescription(s.description || '');
      setPrice(s.price.toString());
      setSlaMinutes((s.slaMinutes || s.estimatedTimeMinutes || 15).toString());
    } else {
      setEditingService(null);
      setName('');
      setCategory('Housekeeping');
      setDepartment('HOUSEKEEPING');
      setDescription('');
      setPrice('0');
      setSlaMinutes('15');
    }
    setIsEditModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        categoryId: category.trim(),
        department,
        description: description.trim(),
        price: parseFloat(price) || 0,
        slaMinutes: parseInt(slaMinutes, 10) || 15,
        estimatedTimeMinutes: parseInt(slaMinutes, 10) || 15,
        isAvailable: editingService ? editingService.isAvailable : true,
      };

      if (editingService) {
        await firestoreService.updateService(hotel.id, editingService.id, payload as any);
      } else {
        await firestoreService.addService(hotel.id, payload as any);
      }
      setIsEditModalOpen(false);
    } catch (err: any) {
      alert(`Error saving service: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (service: HotelService) => {
    if (window.confirm(`Delete service "${service.name}"?`)) {
      try {
        await firestoreService.deleteService(hotel.id, service.id);
      } catch (err: any) {
        alert(err.message || 'Failed to delete service');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-hairline p-6 rounded-xl shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center font-bold">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Services & Amenities Catalog</h2>
              <span className="bg-success-tint text-success-deep border border-success-line text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Supabase Synced
              </span>
            </div>
            <p className="text-xs text-ink-mute">
              Manage extra amenities, toiletries, laundry, and concierge services for guest requests.
            </p>
          </div>
        </div>

        <button
          onClick={() => handleOpenEdit()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> + Add Service
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-lg border border-hairline">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            type="text"
            placeholder="Search services..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-canvas-soft border border-hairline rounded-xl pl-9 pr-3.5 py-2 text-xs text-ink focus:outline-none focus:border-ink"
          />
        </div>
      </div>

      {/* Services Grid or Empty State */}
      {loading ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#0066cc] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-ink-mute mt-3">Loading services…</p>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center mx-auto">
            <Layers className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-ink">
              {searchQuery ? 'No matching services found' : 'No Services Added Yet'}
            </h3>
            <p className="text-xs text-ink-mute">
              {searchQuery
                ? 'Try searching with another term.'
                : 'Configure guest services like extra towels, dental kit, laundry, luggage assistance, and wake-up calls.'}
            </p>
          </div>
          {!searchQuery && (
            <button
              onClick={() => handleOpenEdit()}
              className="px-5 py-2.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add First Service
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServices.map((service) => (
            <div
              key={service.id}
              className="bg-white border border-hairline hover:border-hairline rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-sm text-ink">{service.name}</h3>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] font-mono text-ink-mute uppercase bg-canvas-soft px-2 py-0.5 rounded-md inline-block">
                        {service.categoryId || 'Service'}
                      </span>
                      {service.department && (
                        <span className="text-[10px] font-mono text-[#0066cc] uppercase bg-accent-tint border border-accent-soft px-2 py-0.5 rounded-md inline-block">
                          {DEPARTMENT_OPTIONS.find((d) => d.value === service.department)?.label || service.department}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="font-bold text-sm text-ink">
                    {service.price > 0 ? `${hotel.currencySymbol || '$'}${service.price}` : 'Complimentary'}
                  </span>
                </div>

                {service.description && (
                  <p className="text-xs text-ink-mute mt-2 line-clamp-2">{service.description}</p>
                )}

                <div className="flex items-center gap-1.5 mt-3 text-[11px] text-ink-mute">
                  <Clock className="w-3.5 h-3.5 text-[#0066cc]" />
                  <span>~{service.slaMinutes || service.estimatedTimeMinutes || 15} mins SLA</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between">
                <button
                  onClick={() => handleToggleAvailability(service)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    service.isAvailable
                      ? 'bg-success-tint text-success-deep border border-success-line'
                      : 'bg-accent-tint text-[#004fa3] border border-accent-soft'
                  }`}
                >
                  {service.isAvailable ? 'Available' : 'Unavailable'}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(service)}
                    title="Edit Service"
                    className="p-2 rounded-full hover:bg-canvas-soft text-ink-mute hover:text-ink"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(service)}
                    title="Delete Service"
                    className="p-2 rounded-full hover:bg-accent-tint text-ink-mute hover:text-[#0066cc]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Add/Edit Service */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-hairline">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="text-base font-bold text-ink">
                {editingService ? 'Edit Service' : 'Add New Service'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-full hover:bg-canvas-soft text-ink-mute"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Service Name <span className="text-[#0066cc]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Extra Bath Towels"
                  className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Category <span className="text-[#0066cc]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Housekeeping, Front Desk"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Price ({hotel.currencySymbol || '$'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0 (Free)"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Routes To Department <span className="text-[#0066cc]">*</span>
                </label>
                <select
                  required
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as Department)}
                  className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                >
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-ink-mute mt-1">
                  Decides which staff dispatch queue guest requests for this service land in.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Details for this service request..."
                  className="w-full bg-white border border-hairline rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-ink"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Target Fulfillment SLA (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  value={slaMinutes}
                  onChange={(e) => setSlaMinutes(e.target.value)}
                  className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-hairline text-xs font-semibold text-ink-mute"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
