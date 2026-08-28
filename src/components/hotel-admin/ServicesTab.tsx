import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, HotelService } from '../../types';
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

export const ServicesTab: React.FC<Props> = ({ hotel }) => {
  const [services, setServices] = useState<HotelService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<HotelService | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Housekeeping');
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
      setDescription(s.description || '');
      setPrice(s.price.toString());
      setSlaMinutes((s.slaMinutes || s.estimatedTimeMinutes || 15).toString());
    } else {
      setEditingService(null);
      setName('');
      setCategory('Housekeeping');
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#e8e4dd] p-6 rounded-xl shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center font-bold">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Services & Amenities Catalog</h2>
              <span className="bg-[#e7efee] text-[#0e3030] border border-[#c9dcd9] text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Firestore Synced
              </span>
            </div>
            <p className="text-xs text-[#73706d]">
              Manage extra amenities, toiletries, laundry, and concierge services for guest requests.
            </p>
          </div>
        </div>

        <button
          onClick={() => handleOpenEdit()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> + Add Service
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-lg border border-[#e8e4dd]">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#73706d]" />
          <input
            type="text"
            placeholder="Search services..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#fafaf8] border border-[#e8e4dd] rounded-xl pl-9 pr-3.5 py-2 text-xs text-[#292827] focus:outline-none focus:border-[#292827]"
          />
        </div>
      </div>

      {/* Services Grid or Empty State */}
      {loading ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#1b1938] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#73706d] mt-3">Loading services from Firestore...</p>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center mx-auto">
            <Layers className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-[#292827]">
              {searchQuery ? 'No matching services found' : 'No Services Added Yet'}
            </h3>
            <p className="text-xs text-[#73706d]">
              {searchQuery
                ? 'Try searching with another term.'
                : 'Configure guest services like extra towels, dental kit, laundry, luggage assistance, and wake-up calls.'}
            </p>
          </div>
          {!searchQuery && (
            <button
              onClick={() => handleOpenEdit()}
              className="px-5 py-2.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm inline-flex items-center gap-2"
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
              className="bg-white border border-[#e8e4dd] hover:border-[#e8e4dd] rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-sm text-[#292827]">{service.name}</h3>
                    <span className="text-[10px] font-mono text-[#73706d] uppercase bg-[#fafaf8] px-2 py-0.5 rounded-md mt-1 inline-block">
                      {service.categoryId || 'Service'}
                    </span>
                  </div>

                  <span className="font-bold text-sm text-[#292827]">
                    {service.price > 0 ? `${hotel.currencySymbol || '$'}${service.price}` : 'Complimentary'}
                  </span>
                </div>

                {service.description && (
                  <p className="text-xs text-[#73706d] mt-2 line-clamp-2">{service.description}</p>
                )}

                <div className="flex items-center gap-1.5 mt-3 text-[11px] text-[#73706d]">
                  <Clock className="w-3.5 h-3.5 text-[#1b1938]" />
                  <span>~{service.slaMinutes || service.estimatedTimeMinutes || 15} mins SLA</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[#e8e4dd] flex items-center justify-between">
                <button
                  onClick={() => handleToggleAvailability(service)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    service.isAvailable
                      ? 'bg-[#e7efee] text-[#0e3030] border border-[#c9dcd9]'
                      : 'bg-[#ece6fb] text-[#0e0c1f] border border-[#c9b4fa]'
                  }`}
                >
                  {service.isAvailable ? 'Available' : 'Unavailable'}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(service)}
                    title="Edit Service"
                    className="p-2 rounded-full hover:bg-[#fafaf8] text-[#73706d] hover:text-[#292827]"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(service)}
                    title="Delete Service"
                    className="p-2 rounded-full hover:bg-[#ece6fb] text-[#73706d] hover:text-[#1b1938]"
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
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-[#e8e4dd]">
            <div className="flex items-center justify-between border-b border-[#e8e4dd] pb-3">
              <h3 className="text-base font-bold text-[#292827]">
                {editingService ? 'Edit Service' : 'Add New Service'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-full hover:bg-[#fafaf8] text-[#73706d]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Service Name <span className="text-[#1b1938]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Extra Bath Towels"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Category <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Housekeeping, Front Desk"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Price ({hotel.currencySymbol || '$'})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0 (Free)"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Details for this service request..."
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl p-2.5 text-xs text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Target Fulfillment SLA (minutes)
                </label>
                <input
                  type="number"
                  min="1"
                  value={slaMinutes}
                  onChange={(e) => setSlaMinutes(e.target.value)}
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e8e4dd]">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#e8e4dd] text-xs font-semibold text-[#73706d]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-xs font-bold text-white shadow-sm disabled:opacity-50"
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
